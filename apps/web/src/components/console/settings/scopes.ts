/** API key scopes in plain words. Shared by the create dialog and the API keys page. */
export const SCOPE_INFO: { scope: string; label: string; detail: string; usedBy: string }[] = [
  { scope: "deploy:read", label: "deploy:read", detail: "Read config, deployments, events and jobs.", usedBy: "alror status, alror config pull" },
  { scope: "deploy:write", label: "deploy:write", detail: "Record deployments and events, queue deploy and rollback jobs.", usedBy: "alror deploy, CI pipelines" },
  { scope: "jobs:run", label: "jobs:run", detail: "Claim and finish jobs. Needed by alror runner.", usedBy: "alror runner" },
  { scope: "config:write", label: "config:write", detail: "Push services and policy with alror config push.", usedBy: "alror config push" },
];

export const SCOPE_PRESETS: { label: string; scopes: string[]; detail: string }[] = [
  { label: "CLI", scopes: ["deploy:read", "deploy:write"], detail: "A developer's laptop" },
  { label: "Runner", scopes: ["deploy:read", "deploy:write", "jobs:run"], detail: "Runs queued deploys" },
  { label: "CI", scopes: ["deploy:read", "deploy:write"], detail: "Deploys from a pipeline" },
  { label: "Admin", scopes: ["deploy:read", "deploy:write", "jobs:run", "config:write"], detail: "Everything, including config" },
];
