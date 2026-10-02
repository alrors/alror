import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Power, Trash2 } from "lucide-react";
import { ConfirmAction } from "@/components/console/confirm-action";
import { MarketBadges } from "@/components/console/marketplace-card";
import { MarketplaceConfigForm } from "@/components/console/marketplace-config-form";
import { MarketRichText, MarketSnippet, MarketSteps } from "@/components/console/marketplace-detail";
import { MarketplaceLogo } from "@/components/console/marketplace-logo";
import { MarketplaceVote } from "@/components/console/marketplace-vote";
import { buttonClass, Card, Field } from "@/components/console/primitives";
import { requireSession } from "@/lib/console/auth";
import { DOCS_URL as LOCAL_DOCS_URL } from "@/lib/console/config";
import { dateTime } from "@/lib/console/format";
import { ctxFor } from "@/lib/server/auth/accounts";
import { isAdminRole } from "@/lib/server/context";
import { maskSecret } from "@/lib/server/data/plugins";
import { getCatalogItem } from "@/lib/server/marketplace/catalog";
import { disablePluginAction, uninstallPluginAction } from "../actions";
import { loadMarket } from "../state";

// Page titles of the docs the catalog links to (alror docs).
const DOCS_TITLES: Record<string, string> = {
  targets: "Targets and metrics",
  configuration: "Configuration",
  github: "GitHub integration",
  cli: "CLI reference",
  connected: "Connected mode and SDKs",
};

// Same docs link the shell uses: NEXT_PUBLIC_ALROR_DOCS_URL when set, else the local docs server.
const DOCS_URL = (process.env.NEXT_PUBLIC_ALROR_DOCS_URL || LOCAL_DOCS_URL).replace(/\/+$/, "");

const STATUS_LABEL = {
  installed: "Installed and enabled",
  disabled: "Installed, disabled",
  available: "Not installed",
  builtin: "Built in, always available",
  guide: "Runs outside the workspace",
  planned: "Planned, not built yet",
} as const;

export async function generateMetadata({ params }: PageProps<"/app/marketplace/[id]">): Promise<Metadata> {
  const { id } = await params;
  return { title: getCatalogItem(id)?.name ?? "Marketplace" };
}

export default async function MarketplaceItemPage({ params }: PageProps<"/app/marketplace/[id]">) {
  const { id } = await params;
  const item = getCatalogItem(id);
  if (!item) notFound();

  const session = await requireSession();
  const admin = isAdminRole(session.role);
  const { items, rows, policy } = await loadMarket(ctxFor(session));
  const view = items.find((i) => i.id === item.id)!;
  const row = rows.get(item.id);
  const state = view.state;
  const installable = item.kind === "installable";
  const docsHref = `${DOCS_URL}/${item.docs}`;
  const provider = policy.metrics.provider || "synthetic";
  const providerName = items.find((i) => i.category === "metrics" && i.id === provider)?.name ?? provider;

  // Values for the form: what is stored, else the catalog defaults.
  const values: Record<string, string> = {};
  for (const f of item.fields) {
    const v = row?.config[f.key] ?? f.default;
    if (v !== undefined) values[f.key] = v;
  }
  const secretMask = item.fields.some((f) => f.storage === "policy") ? maskSecret(policy.slack_webhook) : null;

  const headerActions = (
    <>
      {item.kind === "planned" && view.votes && <MarketplaceVote id={item.id} name={item.name} initial={view.votes} />}
      {installable && state === "available" && admin && (
        <a href="#configure" className={buttonClass.primary}>
          Install
        </a>
      )}
      {installable && admin && state === "installed" && (
        <ConfirmAction
          action={disablePluginAction}
          fields={{ id: item.id }}
          label="Disable"
          prompt={item.category === "metrics" ? "Switch back to synthetic metrics?" : "Keep the settings but turn it off?"}
          tone="secondary"
          icon={<Power size={14} />}
        />
      )}
      {installable && admin && (state === "installed" || state === "disabled") && (
        <ConfirmAction
          action={uninstallPluginAction}
          fields={{ id: item.id }}
          label="Uninstall"
          prompt="Remove it and its settings?"
          icon={<Trash2 size={14} />}
        />
      )}
      <a href={docsHref} target="_blank" rel="noreferrer" className={buttonClass.secondary}>
        Docs
        <ArrowUpRight size={14} className="text-con-fg3" />
      </a>
    </>
  );

  const configurable = installable && item.fields.length > 0;
  const metricsLine =
    item.category === "metrics" ? (
      <Field label="Metrics provider now">
        <span className="font-mono text-[13px]">{provider}</span>
        {provider !== item.metricsProvider && <span className="text-con-fg3"> ({providerName})</span>}
      </Field>
    ) : null;

  return (
    <div className="space-y-6">
      <div className="con-fade-up flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <MarketplaceLogo id={item.id} name={item.name} logo={item.logo} size="lg" />
          <div className="min-w-0">
            <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-con-fg">{item.name}</h1>
            <p className="mt-1 max-w-2xl text-[14px] text-con-fg2">{item.summary}</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <MarketBadges item={view} />
              <span className="text-[12px] text-con-fg3">
                {view.categoryLabel} · {item.publisher}
                {item.version && <span className="font-mono"> · v{item.version}</span>}
                {item.note && <> · {item.note}</>}
              </span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-start gap-2 md:justify-end">{headerActions}</div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="con-stagger min-w-0 space-y-6">
          <Card title="Overview">
            <MarketRichText text={item.description} />
          </Card>

          <Card title="What this changes" description={installable ? "What installing, disabling and uninstalling do in this workspace." : undefined}>
            <ul className="space-y-2">
              {item.changes.map((c, i) => (
                <li key={i} className="flex gap-2.5 text-[14px] leading-[1.6] text-con-fg2">
                  <span aria-hidden className="mt-[0.7em] h-1 w-1 shrink-0 rounded-full bg-con-fg3" />
                  <span className="min-w-0">{c}</span>
                </li>
              ))}
            </ul>
          </Card>

          {configurable && (
            <div id="configure" className="scroll-mt-6">
              <Card
                title="Configuration"
                description={
                  state === "available"
                    ? "Fill these in and install. Values are stored for this organization; secrets never are."
                    : "Non-secret settings stored for this organization. Saving applies them on the next CLI or runner run."
                }
              >
                <MarketplaceConfigForm
                  id={item.id}
                  name={item.name}
                  fields={item.fields}
                  values={values}
                  state={state === "installed" || state === "disabled" ? state : "available"}
                  canEdit={admin}
                  secretMask={secretMask}
                  replaces={item.category === "metrics" && provider !== item.metricsProvider ? providerName : undefined}
                />
              </Card>
            </div>
          )}

          {item.snippets && item.snippets.length > 0 && (
            <Card
              title={item.category === "libraries" ? "Install" : "Workflows"}
              description={
                item.category === "libraries" ? "Nothing to install in the workspace: add it where your code runs." : "Copy these into your repository."
              }
            >
              <div className="space-y-3">
                {item.snippets.map((s) => (
                  <MarketSnippet key={s.label} snippet={s} />
                ))}
              </div>
            </Card>
          )}

          {item.setup.length > 0 && (
            <Card title="Setup">
              <MarketSteps steps={item.setup} />
            </Card>
          )}
        </div>

        <aside className="min-w-0 space-y-6">
          <Card title="Details">
            <dl className="-my-2.5 divide-y divide-con-row">
              <Field label="Status">{STATUS_LABEL[state]}</Field>
              {metricsLine}
              {item.id === "slack" && (
                <Field label="Webhook">
                  {secretMask ? <span className="font-mono text-[12px]">{secretMask}</span> : <span className="text-con-fg3">Not set</span>}
                </Field>
              )}
              {view.votes && (
                <Field label="Votes">
                  <span className="font-mono tabular-nums">{view.votes.count}</span>
                </Field>
              )}
              <Field label="Version">
                {item.version ? <span className="font-mono text-[13px]">v{item.version}</span> : <span className="text-con-fg3">Not released</span>}
              </Field>
              <Field label="Publisher">{item.publisher}</Field>
              <Field label="Category">{view.categoryLabel}</Field>
              {row?.installed_by && <Field label="Installed by">{row.installed_by}</Field>}
              {row && <Field label="Installed">{dateTime(row.installed_at)}</Field>}
              {row && row.updated_at !== row.installed_at && <Field label="Updated">{dateTime(row.updated_at)}</Field>}
              <Field label="Docs">
                <a href={docsHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-con-fg underline-offset-4 hover:underline">
                  {DOCS_TITLES[item.docs] ?? "Documentation"}
                  <ArrowUpRight size={13} className="text-con-fg3" />
                </a>
              </Field>
            </dl>
          </Card>

          {installable && !admin && (
            <p className="rounded-lg border border-con-line px-4 py-3 text-[13px] leading-[1.55] text-con-fg2">
              You can browse this plugin. Owners and admins of {session.org.name} install, configure and remove plugins.
            </p>
          )}

          <Link href="/app/marketplace" className="inline-flex items-center gap-1.5 text-[13px] text-con-fg2 transition-colors duration-150 hover:text-con-fg">
            <ArrowLeft size={14} />
            All plugins and libraries
          </Link>
        </aside>
      </div>
    </div>
  );
}
