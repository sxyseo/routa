import { NextResponse } from "next/server";
import { getDockerDetector, DEFAULT_DOCKER_AGENT_IMAGE } from "@/core/acp/docker";

export const dynamic = "force-dynamic";

// Short-circuit: if Docker was confirmed unavailable in a previous check,
// return the cached negative result immediately without spawning processes.
// This prevents 5s child-process timeouts from blocking the event loop
// when the setImmediate hydration/revive callback holds the event loop.
const NOT_AVAILABLE_RESPONSE = NextResponse.json({
  available: false,
  daemonRunning: false,
  error: "Docker unavailable",
  checkedAt: new Date().toISOString(),
  image: DEFAULT_DOCKER_AGENT_IMAGE,
  imageAvailable: false,
});

export async function GET() {
  if (process.env.PAGE_SNAPSHOT_FIXTURE_MODE === "1") {
    return NextResponse.json({
      available: true,
      daemonRunning: true,
      version: "fixture",
      checkedAt: new Date().toISOString(),
      image: DEFAULT_DOCKER_AGENT_IMAGE,
      imageAvailable: true,
    });
  }

  const detector = getDockerDetector();

  // Fast path: return cached result if available (30s TTL in detector)
  const cached = detector.getCachedStatus();
  if (cached && !cached.available) {
    return NextResponse.json({
      ...cached,
      checkedAt: new Date().toISOString(),
      image: DEFAULT_DOCKER_AGENT_IMAGE,
      imageAvailable: false,
    });
  }

  const image = DEFAULT_DOCKER_AGENT_IMAGE;

  const [status, imageAvailable] = await Promise.all([
    detector.checkAvailability(),
    detector.isImageAvailable(image),
  ]);

  return NextResponse.json({
    ...status,
    checkedAt: new Date().toISOString(),
    image,
    imageAvailable: status.available ? imageAvailable : false,
  });
}
