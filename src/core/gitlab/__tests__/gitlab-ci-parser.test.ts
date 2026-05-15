// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseGitLabCI, ParseError } from "../gitlab-ci-parser";

// ─── Helper: minimal valid .gitlab-ci.yml ──────────────────────────────────

const MINIMAL_YML = `
build:
  script:
    - echo "hello"
`;

// ─── AC1: Basic parsing — stages, jobs, dependencies ───────────────────────

describe("parseGitLabCI — basic structure", () => {
  it("parses a minimal .gitlab-ci.yml with one job", () => {
    const result = parseGitLabCI(MINIMAL_YML);
    expect(result.pipeline.jobs).toHaveLength(1);
    expect(result.pipeline.jobs[0].id).toBe("build");
    expect(result.pipeline.jobs[0].script).toEqual(['echo "hello"']);
    expect(result.pipeline.jobs[0].stage).toBe("test"); // default stage
  });

  it("extracts explicit stages", () => {
    const yml = `
stages:
  - lint
  - build
  - test
  - deploy

lint-job:
  stage: lint
  script:
    - npm run lint

build-job:
  stage: build
  script:
    - npm run build

test-job:
  stage: test
  script:
    - npm test

deploy-job:
  stage: deploy
  script:
    - npm run deploy
`;
    const result = parseGitLabCI(yml);
    expect(result.pipeline.stages).toHaveLength(4);
    expect(result.pipeline.stages.map((s) => s.name)).toEqual(["lint", "build", "test", "deploy"]);
    expect(result.pipeline.jobs).toHaveLength(4);
    expect(result.pipeline.stages[0].jobs).toEqual(["lint-job"]);
    expect(result.pipeline.stages[3].jobs).toEqual(["deploy-job"]);
  });

  it("uses default stages when none specified", () => {
    const result = parseGitLabCI(MINIMAL_YML);
    expect(result.pipeline.stages.map((s) => s.name)).toEqual(["build", "test", "deploy"]);
  });

  it("extracts job-level fields: image, tags, when, allow_failure", () => {
    const yml = `
docker-build:
  image: docker:24.0
  tags:
    - docker
    - linux
  when: manual
  allow_failure: true
  script:
    - docker build .
`;
    const result = parseGitLabCI(yml);
    const job = result.pipeline.jobs[0];
    expect(job.image).toBe("docker:24.0");
    expect(job.tags).toEqual(["docker", "linux"]);
    expect(job.when).toBe("manual");
    expect(job.allowFailure).toBe(true);
  });

  it("extracts needs/dependencies between jobs", () => {
    const yml = `
stages:
  - build
  - test
  - deploy

build:
  stage: build
  script:
    - make build

test-unit:
  stage: test
  needs: [build]
  script:
    - make test

test-integration:
  stage: test
  needs: [build]
  script:
    - make integration-test

deploy:
  stage: deploy
  needs: [test-unit, test-integration]
  script:
    - make deploy
`;
    const result = parseGitLabCI(yml);
    expect(result.pipeline.dependencies).toEqual([
      { from: "test-unit", to: "build" },
      { from: "test-integration", to: "build" },
      { from: "deploy", to: "test-unit" },
      { from: "deploy", to: "test-integration" },
    ]);
    expect(result.pipeline.jobs.find((j) => j.id === "deploy")!.needs).toEqual([
      "test-unit",
      "test-integration",
    ]);
  });

  it("handles needs with job objects (needs: [{job: name}])", () => {
    const yml = `
build:
  script: [echo build]

deploy:
  needs:
    - job: build
      artifacts: true
  script: [echo deploy]
`;
    const result = parseGitLabCI(yml);
    const deploy = result.pipeline.jobs.find((j) => j.id === "deploy");
    expect(deploy!.needs).toEqual(["build"]);
  });
});

// ─── AC3: GitLab-specific syntax ───────────────────────────────────────────

describe("parseGitLabCI — GitLab-specific features", () => {
  it("extracts extends", () => {
    const yml = `
.tests:
  stage: test
  script:
    - echo "test template"

unit-test:
  extends: .tests
  script:
    - echo "unit test"

integration-test:
  extends: [.tests]
  script:
    - echo "integration test"
`;
    const result = parseGitLabCI(yml);
    expect(result.pipeline.jobs.find((j) => j.id === "unit-test")!.extends).toEqual([".tests"]);
    expect(result.pipeline.jobs.find((j) => j.id === "integration-test")!.extends).toEqual([".tests"]);
  });

  it("extracts include declarations", () => {
    const yml = `
include:
  - local: /ci/build.yml
  - remote: https://example.com/ci.yml
  - template: Auto-DevOps.gitlab-ci.yml
  - project: my-group/my-project
    ref: main
    file: /ci/deploy.yml
`;
    const result = parseGitLabCI(yml);
    expect(result.pipeline.includes).toHaveLength(4);
    expect(result.pipeline.includes[0]).toEqual({ local: "/ci/build.yml" });
    expect(result.pipeline.includes[1]).toEqual({ remote: "https://example.com/ci.yml" });
    expect(result.pipeline.includes[2]).toEqual({ template: "Auto-DevOps.gitlab-ci.yml" });
    expect(result.pipeline.includes[3]).toEqual({
      project: "my-group/my-project",
      ref: "main",
      file: "/ci/deploy.yml",
    });
  });

  it("handles YAML anchors and aliases (handled by js-yaml natively)", () => {
    const yml = `
.vars: &global_vars
  APP_NAME: myapp
  VERSION: "1.0"

build:
  variables: *global_vars
  script:
    - echo $APP_NAME
`;
    const result = parseGitLabCI(yml);
    // Hidden template ".vars" should not appear as a job
    expect(result.pipeline.jobs.find((j) => j.id === ".vars")).toBeUndefined();
    const buildJob = result.pipeline.jobs.find((j) => j.id === "build");
    expect(buildJob!.variables).toEqual({
      APP_NAME: "myapp",
      VERSION: "1.0",
    });
  });

  it("extracts workflow rules", () => {
    const yml = `
workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      when: always
    - if: $CI_COMMIT_BRANCH == "main"
      variables:
        DEPLOY: "true"
`;
    const result = parseGitLabCI(yml);
    expect(result.pipeline.workflow).not.toBeNull();
    expect(result.pipeline.workflow!.rules).toHaveLength(2);
    expect(result.pipeline.workflow!.rules[0]).toEqual({
      if: '$CI_PIPELINE_SOURCE == "merge_request_event"',
      when: "always",
    });
    expect(result.pipeline.workflow!.rules[1]).toEqual({
      if: '$CI_COMMIT_BRANCH == "main"',
      variables: { DEPLOY: "true" },
    });
  });
});

// ─── AC4: Variable handling ────────────────────────────────────────────────

describe("parseGitLabCI — variables", () => {
  it("extracts global variables", () => {
    const yml = `
variables:
  APP_NAME: myapp
  REGISTRY: registry.example.com
  DEPLOY_ENV:
    value: "staging"
    description: "Deployment environment"
`;
    const result = parseGitLabCI(yml);
    expect(result.pipeline.variables).toEqual({
      APP_NAME: "myapp",
      REGISTRY: "registry.example.com",
      DEPLOY_ENV: { value: "staging", description: "Deployment environment" },
    });
  });

  it("extracts job-level variables with inheritance", () => {
    const yml = `
variables:
  GLOBAL_VAR: global_value

build:
  variables:
    JOB_VAR: job_value
    GLOBAL_VAR: overridden
  script:
    - echo build
`;
    const result = parseGitLabCI(yml);
    // Global variables should be in pipeline.variables
    expect(result.pipeline.variables.GLOBAL_VAR).toBe("global_value");
    // Job-level variables should be in job.variables
    const buildJob = result.pipeline.jobs.find((j) => j.id === "build");
    expect(buildJob!.variables).toEqual({
      JOB_VAR: "job_value",
      GLOBAL_VAR: "overridden",
    });
  });
});

// ─── AC5: Error handling ───────────────────────────────────────────────────

describe("parseGitLabCI — error handling", () => {
  it("throws ParseError for invalid YAML", () => {
    const yml = `
stages:
  - build
  invalid: [yaml: content
    unclosed
`;
    expect(() => parseGitLabCI(yml)).toThrow(ParseError);
  });

  it("returns warnings for empty pipeline (no jobs)", () => {
    const yml = `
stages:
  - build
`;
    const result = parseGitLabCI(yml);
    expect(result.pipeline.jobs).toHaveLength(0);
  });

  it("returns warnings for non-array stages", () => {
    const yml = `
stages: not-an-array
build:
  script: [echo hi]
`;
    const result = parseGitLabCI(yml);
    expect(result.warnings).toContain("stages 字段不是数组，使用默认 stages");
  });

  it("returns warnings for undefined stage reference", () => {
    const yml = `
stages:
  - build
deploy:
  stage: deploy
  script: [echo deploy]
`;
    const result = parseGitLabCI(yml);
    expect(result.warnings).toContain('Job "deploy" 引用了未定义的 stage "deploy"');
  });

  it("handles allow_failure with exit_codes", () => {
    const yml = `
test:
  allow_failure:
    exit_codes: [137, 255]
  script: [echo test]
`;
    const result = parseGitLabCI(yml);
    expect(result.pipeline.jobs[0].allowFailure).toEqual({ exit_codes: [137, 255] });
  });

  it("returns warning for non-object YAML", () => {
    const result = parseGitLabCI("- item1\n- item2");
    expect(result.warnings).toContain("YAML 内容解析结果不是有效的对象");
  });
});

// ─── AC6: Real-world patterns ──────────────────────────────────────────────

describe("parseGitLabCI — real-world patterns (AC6)", () => {
  // Pattern 1: Monorepo multi-stage
  it("handles monorepo multi-stage pipeline", () => {
    const yml = `
stages:
  - build-frontend
  - build-backend
  - test
  - integration
  - deploy-staging
  - deploy-production

variables:
  REGISTRY: $CI_REGISTRY
  FRONTEND_DIR: frontend
  BACKEND_DIR: backend

build-frontend:
  stage: build-frontend
  image: node:20
  script:
    - cd \$FRONTEND_DIR && npm ci && npm run build
  artifacts:
    paths:
      - frontend/dist/

build-backend:
  stage: build-backend
  image: golang:1.21
  script:
    - cd \$BACKEND_DIR && go build -o app .
  artifacts:
    paths:
      - backend/app

test-frontend:
  stage: test
  image: node:20
  needs: [build-frontend]
  script:
    - cd \$FRONTEND_DIR && npm test

test-backend:
  stage: test
  image: golang:1.21
  needs: [build-backend]
  script:
    - cd \$BACKEND_DIR && go test ./...

integration-test:
  stage: integration
  needs: [test-frontend, test-backend]
  script:
    - docker-compose up -d
    - docker-compose run integration-tests

deploy-staging:
  stage: deploy-staging
  needs: [integration-test]
  when: manual
  script:
    - kubectl apply -f k8s/staging/
  environment: staging

deploy-production:
  stage: deploy-production
  needs: [deploy-staging]
  when: manual
  script:
    - kubectl apply -f k8s/production/
  environment:
    name: production
`;
    const result = parseGitLabCI(yml);

    // Verify stages
    expect(result.pipeline.stages).toHaveLength(6);
    expect(result.pipeline.stages.map((s) => s.name)).toEqual([
      "build-frontend", "build-backend", "test",
      "integration", "deploy-staging", "deploy-production",
    ]);

    // Verify jobs
    expect(result.pipeline.jobs).toHaveLength(7);
    expect(result.pipeline.stages[0].jobs).toEqual(["build-frontend"]);
    expect(result.pipeline.stages[1].jobs).toEqual(["build-backend"]);
    expect(result.pipeline.stages[2].jobs).toEqual(["test-frontend", "test-backend"]);

    // Verify dependencies
    expect(result.pipeline.dependencies).toContainEqual({ from: "integration-test", to: "test-frontend" });
    expect(result.pipeline.dependencies).toContainEqual({ from: "integration-test", to: "test-backend" });
    expect(result.pipeline.dependencies).toContainEqual({ from: "deploy-staging", to: "integration-test" });

    // Verify variables
    expect(result.pipeline.variables.FRONTEND_DIR).toBe("frontend");
    expect(result.pipeline.variables.BACKEND_DIR).toBe("backend");

    // Verify manual triggers
    expect(result.pipeline.jobs.find((j) => j.id === "deploy-staging")!.when).toBe("manual");
    expect(result.pipeline.jobs.find((j) => j.id === "deploy-production")!.when).toBe("manual");
  });

  // Pattern 2: Matrix / parallel builds
  it("handles matrix build pattern with parallel and variables", () => {
    const yml = `
stages:
  - test

test:
  stage: test
  image: node:\${NODE_VERSION}
  parallel: 3
  variables:
    NODE_VERSION: "20"
  script:
    - node --version
    - npm ci
    - npm test
  tags:
    - docker
`;
    const result = parseGitLabCI(yml);
    expect(result.pipeline.jobs).toHaveLength(1);
    const job = result.pipeline.jobs[0];
    expect(job.tags).toEqual(["docker"]);
    expect(job.variables).toEqual({ NODE_VERSION: "20" });
  });

  // Pattern 3: Trigger downstream pipeline
  it("handles downstream pipeline trigger pattern", () => {
    const yml = `
stages:
  - build
  - trigger

build:
  stage: build
  script:
    - make build
  artifacts:
    paths:
      - dist/

trigger-deploy:
  stage: trigger
  needs: [build]
  trigger:
    project: ops/deployment
    branch: main
    strategy: depend
`;
    const result = parseGitLabCI(yml);
    expect(result.pipeline.jobs).toHaveLength(2);
    expect(result.pipeline.jobs[1].id).toBe("trigger-deploy");
    expect(result.pipeline.jobs[1].needs).toEqual(["build"]);
    expect(result.pipeline.dependencies).toEqual([{ from: "trigger-deploy", to: "build" }]);
  });
});
