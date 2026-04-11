/** @type {import("@docusaurus/plugin-content-docs").SidebarsConfig} */
module.exports = {
  docsSidebar: [
    {
      type: "doc",
      id: "quickstart",
      label: "Home",
    },
    {
      type: "category",
      label: "Getting Started",
      collapsible: false,
      collapsed: false,
      items: [
        {
          type: "doc",
          id: "getting-started/index",
          label: "Overview",
        },
        {
          type: "doc",
          id: "quick-start",
          label: "Quick Start",
        },
        {
          type: "doc",
          id: "getting-started/changelog",
          label: "Changelog",
        },
      ],
    },
    {
      type: "category",
      label: "Core Concepts",
      collapsible: false,
      collapsed: false,
      items: [
        {
          type: "doc",
          id: "core-concepts/index",
          label: "Overview",
        },
        {
          type: "doc",
          id: "core-concepts/how-routa-works",
          label: "How Routa Works",
        },
        {
          type: "doc",
          id: "ARCHITECTURE",
          label: "Architecture",
        },
        {
          type: "doc",
          id: "design-docs/execution-modes",
          label: "Execution Modes",
        },
      ],
    },
    {
      type: "category",
      label: "Use Routa",
      collapsible: false,
      collapsed: false,
      items: [
        {
          type: "doc",
          id: "use-routa/index",
          label: "Overview",
        },
        {
          type: "doc",
          id: "use-routa/sessions",
          label: "Sessions",
        },
        {
          type: "doc",
          id: "use-routa/kanban",
          label: "Kanban",
        },
        {
          type: "doc",
          id: "use-routa/team",
          label: "Team",
        },
        {
          type: "doc",
          id: "use-routa/common-workflows",
          label: "Common Workflows",
        },
        {
          type: "doc",
          id: "use-routa/best-practices",
          label: "Best Practices",
        },
      ],
    },
    {
      type: "category",
      label: "Platforms",
      collapsible: false,
      collapsed: false,
      items: [
        {
          type: "doc",
          id: "platforms/index",
          label: "Overview",
        },
        {
          type: "doc",
          id: "platforms/desktop",
          label: "Desktop",
        },
        {
          type: "doc",
          id: "platforms/cli",
          label: "CLI",
        },
        {
          type: "doc",
          id: "platforms/web",
          label: "Web",
        },
      ],
    },
    {
      type: "category",
      label: "Deployment",
      collapsible: false,
      collapsed: false,
      items: [
        {
          type: "doc",
          id: "deployment/index",
          label: "Deployment Overview",
        },
        {
          type: "doc",
          id: "release-guide",
          label: "Release Guide",
        },
      ],
    },
    {
      type: "category",
      label: "Configuration",
      collapsible: false,
      collapsed: false,
      items: [
        {
          type: "doc",
          id: "configuration/index",
          label: "Overview",
        },
        {
          type: "doc",
          id: "configuration/providers-and-models",
          label: "Providers and Models",
        },
        {
          type: "doc",
          id: "configuration/environment-variables",
          label: "Environment Variables",
        },
      ],
    },
    {
      type: "category",
      label: "Reference",
      collapsible: false,
      collapsed: false,
      items: [
        {
          type: "doc",
          id: "reference/index",
          label: "Overview",
        },
        {
          type: "doc",
          id: "product-specs/FEATURE_TREE",
          label: "Product Specs",
        },
        {
          type: "link",
          label: "Specialists",
          href: "/specialists",
        },
        {
          type: "doc",
          id: "coding-style",
          label: "Code Style",
        },
        {
          type: "doc",
          id: "reference/resources",
          label: "Resources",
        },
      ],
    },
  ],
};
