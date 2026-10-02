# Alror product direction

This document preserves the deployment-platform direction the founder liked on October 3, 2026, and the broader application-platform proposal discussed afterward. These are saved explorations, not the current implementation sequence or a committed delivery schedule.

## Current implementation plan

The current working direction is open-source execution infrastructure for trusted background workloads on user-owned servers. Start with one Linux VM, durable task attempts, bounded resource use, real progress, cancellation and verified process recovery. Reuse Alror's runner, authenticated API, Postgres, SDK and console while maintaining existing GitHub and deployment features.

The [execution runtime roadmap](https://github.com/alrors/alror/issues/1) tracks three gates: define the contract and benchmark alternatives; prove a real single-VM runtime; validate it with three independent developers. Each linked issue has acceptance criteria and dependencies. The [organization project](https://github.com/orgs/alrors/projects/1) tracks priority through Now, Next and Later.

The proposed advantage is predictable resource use and understandable recovery on small servers. It must be measured against existing tools. The first alpha does not include managed customer compute, hostile-code sandboxes, arbitrary process checkpointing, multi-host availability or an exactly-once guarantee for external effects. The plans below remain preserved for context and possible later expansion.

## Saved deployment platform plan

Build an open-source application deployment platform with this promise: connect your repository and your server; Alror builds, deploys, routes traffic, and helps recover from failures.

| Developer need | Intended capability |
| --- | --- |
| Ship an application | Git deployments, builds, preview environments |
| Run it reliably | Containers, domains, HTTPS, health checks |
| Release changes safely | Traffic control, release verification, rollback |
| Understand problems | Logs, metrics, deployment history |
| Work with others | Projects, permissions, secrets, audit history |

The first complete journey is: connect a VM, connect GitHub, deploy one Dockerized HTTP application, get HTTPS, push an update, and recover from a broken release. Start with readiness checks and a verified blue-green traffic switch. Retain the previous immutable release for rollback. Percentage-based canaries follow reliable recovery.

Later expansion can include databases and backups, workers, scheduled jobs, multiple servers, and optional managed hosting. Choose additions from observed user needs.

The founder's current infrastructure budget is the existing approximately $7 monthly VM. Use it for Alror's coordination service and a small prototype subject to measured capacity. Users supply infrastructure for their applications. Additional builds, storage, telemetry, and preview environments consume resources; this plan does not promise unlimited hosting or free operation at scale.

## Proposed broader application platform

Alror could become the system developers use to operate a complete application throughout its life. Deployment would be one operation alongside provisioning dependencies, managing environments, running background work, controlling access, observing behavior, and recovering from incidents.

The central object would be a versioned application definition: services, dependencies, configuration references, environments, resource limits, and operating policies. Alror would track both the requested configuration and what is actually running. Credentials would remain outside that definition in protected secret storage.

Developers and AI agents would use the same authenticated API to propose changes, inspect their effects, execute actions within permissions, and inspect the evidence afterward. AI is an optional client of the platform; correctness must come from validated plans, bounded permissions, durable execution, and observed results.

| Part of the application | Proposed Alror responsibility |
| --- | --- |
| Web services and workers | Build, run, update, and observe processes |
| Databases, storage, and queues | Connect or provision supported engines; track dependencies and recovery requirements |
| Development and preview environments | Reproduce supported application components with isolated credentials and permitted test data |
| Changes | Explain affected components, order operations, enforce policy, and record results |
| Operations | Relate errors and resource usage to releases; execute supported recovery procedures |

Use established engines for databases, queues, storage, and proxies. Alror's proposed core is the application model and dependable coordination across these components.

## Example of the proposed experience

A developer adds an invoice worker and a queue to an application definition. Alror shows the new resources and permissions, prepares an isolated preview, checks that the worker can process test jobs, and then applies the permitted production changes in dependency order. The application view links its API, queue, worker, relevant logs, and release history.

If the worker fails after release, Alror can restore a compatible previous worker version and report what remains unresolved. Database migrations, delivered messages, payments, and other external effects are not automatically undone by reverting an application image. Every supported operation needs explicit recovery semantics.

## What would make this valuable

The hypothesis is that a solo developer can operate a multi-component application through one understandable workflow, with useful controls for both humans and agents. A collection of dashboards alone would not establish that value.

Related capabilities already exist: [Backstage's catalog](https://backstage.io/docs/features/software-catalog/) organizes software ownership and metadata, and [Supabase branching](https://supabase.com/docs/guides/deployment/branching/) provides isolated Supabase environments. This proposal makes no claim that catalogs, environment branching, or developer platforms are new inventions. Differentiation must be demonstrated in the complete workflow, recovery behavior, portability, and operating effort.

## Evidence required before expansion

1. One HTTP service deploys and recovers through a real router, with observed state in the console.
2. A failed health check never sends user traffic to the candidate; interrupted and concurrent operations recover predictably.
3. One application gains a worker and queue through the same application model and permissions.
4. An isolated preview runs that supported application with test data and explicit resource limits.
5. Independent developers can use the workflow without founder intervention. Measure setup effort, successful recovery, and resources consumed before widening scope.

At the time of this plan, Alror has GitHub checks, a console, and simulated rollout workflows. The general VM deployment controller and the broader capabilities above still require implementation and validation. This document supplements the existing API contract; it does not change its current schema.
