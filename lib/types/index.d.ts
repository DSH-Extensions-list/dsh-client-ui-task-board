/**
 * Host loader entry for the task-board plugin.
 *
 * The Host owns the v2 ledger, action API, cron scheduler, session runner,
 * execution reconciliation, and optional idle-sleep inhibitor. The browser is
 * a same-origin asynchronous view over that service.
 */
import type { Context, Volatile } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { LlmRuntime } from '@deepseek-ai/dsh-llm';
import { type HostTimerFace, type TaskBoardTeamDispatcher } from './host-service.ts';
import { type TaskPermission } from './core/tasks.ts';
/** Default environment variable holding the authenticated proxy token. */
export declare const DEFAULT_PROXY_TOKEN_ENV = "DSH_TASK_BOARD_PROXY_TOKEN";
export declare const inject: string[];
/** Model-facing announcement: plugin presence, capabilities, and limits. */
export declare const TASK_BOARD_GUIDANCE = "The dsh-task-board plugin is installed locally for the DSH Web GUI. Open it from the Task Board item in the sidebar. It is maintained in the dsh-web plugin monorepo at packages/dsh-task-board and can be installed through the web-ui-all aggregate package. Capabilities: manage tasks on a multi-column board backed by a Host-authoritative ledger; the Host continues execution and settlement after the browser closes; tasks can pin a workspace, agent preset, and permission; tasks can have subtasks (configurable depth limit 1..3, default 1, so subtasks cannot have subtasks by default); running a parent executes its subtask tree concurrently; subtasks can override permission and model independently. The plugin also registers task_board_* agent tools (list/get/create/update/set_parent/run/manage/schedule), which any session can use to read and write the board, subtasks, and schedules. Running a task performs real work and consumes API quota. A binding above the session default permission still requires human confirmation in the GUI; the tools deliberately provide no confirmation action. Five-field cron schedules use the Host local time zone, and missed triggers are not replayed. Optional idle system-sleep protection is off by default; it allows the display to turn off but does not promise to prevent lid closure, manual sleep, hibernation, shutdown, or waking an already sleeping machine. Execution consumes API quota. When the user refers to the task board, board, or scheduled tasks, treat that as referring to this plugin. If you also use todo_write to maintain a visible session plan, call todo_write once more before your final response: mark the last completed step completed and leave no in_progress steps when nothing remains.";
/**
 * Plugin config, validated by the same-named schemastery schema.
 *
 * This schema IS the board's settings page: the 0.1.7 Host serves one
 * configuration form per profile entry from the entry's own Config, so the
 * fields the browser card edits are marked volatile — the Loader commits
 * an edit into the running fiber's references without remounting the row (no
 * settings document of the plugin's own exists any more). A field without the
 * marker is refused by the settings write path, which fences writes on
 * volatility.
 */
export interface Config {
    /**
     * When true (default), a system-prompt section announces the board to every
     * agent. Set false to keep the board silent in prompts; agents then learn
     * about it only when the user mentions it.
     */
    announceToAgent?: Volatile<boolean>;
    /** Master switch for the plugin (browser half + host announcement). */
    enabled?: Volatile<boolean>;
    /** Prevent idle system sleep while sessions run or schedules are armed. */
    preventIdleSleep?: Volatile<boolean>;
    /**
     * Canonical reverse-proxy Host authorities admitted with a server-side
     * token. Deployment-level, so it stays an ordinary field: editing it reloads
     * the row, which re-registers the routes with the new proxy access.
     */
    trustedProxyHosts?: string[];
    /** Environment variable whose value the authenticated proxy injects upstream. */
    proxyTokenEnv?: string;
    /**
     * An explicit baseline for the permission confirmation gate. Left unset, the
     * board follows the Host's own default permission preset — the value new DSH
     * sessions start at — and falls back to `read-only` when the deployment
     * serves no permission catalog. A card whose effective permission (handover
     * bundle or pin) is above the baseline requires a human confirmation before
     * it may run; cron refuses unconfirmed cards.
     */
    sessionDefaultPermission?: TaskPermission;
    /**
     * Subtask depth limit, 1..3 (default 1). At 1 a task may carry one level of
     * subtasks and a subtask cannot be given subtasks of its own; raising it
     * allows deeper trees. Every extra level multiplies the sessions one run
     * of the root task opens, so the ceiling is deliberately small.
     */
    maxSubtaskDepth?: Volatile<number>;
    /**
     * How often, in seconds, the Host re-reads the DSH session roster while the
     * board has something to reconcile: a running card, an open execution, or an
     * active provider extension. An idle board with none of those does not poll
     * at all, so this cadence only bounds how quickly a running card settles.
     */
    sessionPollSeconds?: Volatile<number>;
    /**
     * How many run launches this board may have in flight at once (1..16,
     * default 3). One run opens its whole subtree, so without a bound the Host
     * asks DSH for every member's session in the same tick; this is the mechanism
     * that enforces the repository's measured guidance for heavy implementation
     * subagents. Members wait their turn instead of being dropped: the subtree
     * still opens completely, they only enter the running column in batches. Read
     * at each admission, so an edit bounds the next launch of a run that is still
     * queueing.
     */
    runLaunchWidth?: Volatile<number>;
    /**
     * Daily token ceiling for the work this board dispatches (default 0 = no
     * gate). Tokens, not money: the ledger the board measures against prices
     * DeepSeek's own routes only, so a cost cap would read 0 elsewhere. Read at
     * each gate, so an edit binds the next run without a remount; a manual
     * run/rerun whose day already spent the cap is refused, and a due occurrence
     * is skipped onto the scheduler with its run budget untouched.
     */
    spendBudgetTokens?: Volatile<number>;
    /**
     * Continuable-subagent provider the Agent Teams service uses to compose a
     * teammate. Matches the Agent Teams tool plugin's `freshProvider` default;
     * only team-mode runs use it.
     */
    teamProvider?: string;
    /**
     * GLOBAL native /goal switch (default OFF), the master control over whether
     * this board starts a run with dsh's built-in /goal at all. A run uses native
     * /goal only when THIS is on AND the task's own `goalRun` is not off; while
     * it is off every task runs one plain turn.
     *
     * The value is frozen when an execution starts, so toggling it only affects
     * executions that begin afterwards and never re-writes a task's stored
     * `goalRun` preference. A run that consequently does not execute native
     * /goal is marked as such (its acceptance applicability is `goal-disabled`)
     * and is never reported as a passed goal acceptance or failed for lacking a
     * completion call. Independent of `goalVerification`; acceptance governs the
     * completing call of a goal-form run, this switch governs whether the run
     * becomes a goal run.
     */
    goalRunEnabled?: Volatile<boolean>;
    /**
     * Agent preset a NEW card starts from (volatile, default blank = not set).
     * A prefill, never a pin: the create dialog opens with it selected, the
     * caller may override it, and the card stores what it was created with. It
     * reaches the create path only when that caller opts in with
     * `applyCardDefaults`, so the extension provider's own create and the legacy
     * import are untouched.
     */
    cardDefaultMode?: Volatile<string>;
    /**
     * Permission a NEW card starts from (volatile, default blank = not set), one
     * of the three presets. A prefill like the rest: a value above
     * `sessionDefaultPermission` still has to be confirmed by a human before the
     * card may run, because the pre-execution gate is what decides that.
     */
    cardDefaultPermission?: Volatile<TaskPermission | ''>;
    /**
     * Model a NEW card starts from (volatile, default blank = not set).
     */
    cardDefaultModel?: Volatile<string>;
    /**
     * Reasoning level a NEW card starts from (volatile, default blank = not set).
     * Bound to `cardDefaultModel` exactly as a card's own level is bound to its
     * own model: it applies only while the card's final model IS that default
     * model, and a blank `cardDefaultModel` makes it inert.
     */
    cardDefaultReasoningEffort?: Volatile<string>;
    /**
     * Goal acceptance for executions this board starts (default ON). When on,
     * update_goal(action: complete) inside a task execution is refused until an
     * acceptance pass is recorded for that execution: the three coding criteria,
     * a 0.65 threshold, two rounds per criterion with the A/B slots swapped, and
     * at most two acceptances per execution — the first failure returns its
     * findings to the fixing agent, the second ends the cycle. The switch only
     * affects goal-form executions of the board; plain chat and a task pinned to
     * goalRun: false are untouched. When a separate third-party verifier also
     * runs its own automatic acceptance, both judges score independently: this
     * one gates completion, the other only steers, and no public interface lets
     * the two share a verdict.
     */
    goalVerification?: Volatile<boolean>;
    /**
     * Judge model for goal acceptance as provider/model. Blank inherits the HOST's
     * own model catalog default — never the card's pinned execution model.
     */
    goalVerificationModel?: Volatile<string>;
    /**
     * Reasoning effort for the judge. Blank inherits the host default level; an
     * effort the resolved model does not declare is dropped instead of being
     * sent, and the fallback to the model's own default is reported.
     */
    goalVerificationReasoningEffort?: Volatile<string>;
    /**
     * Ceiling of ONE judge request of a goal acceptance, in seconds
     * (30..600, default 150). One acceptance issues six judge requests (three
     * criteria times two rounds), so a ceiling that is too small turns a slow but
     * healthy judge route into a wall of timeouts, and every timeout was charged
     * as an acceptance anomaly. Raise it for a reasoning model reading a long
     * trace.
     */
    goalVerificationCallTimeoutSeconds?: Volatile<number>;
    /**
     * Total ceiling of ONE goal acceptance attempt, in seconds (120..1800,
     * default eight times the per-call default). Keep it at or above
     * `goalVerificationCallTimeoutSeconds` times six or an acceptance can never
     * finish: the attempt then ends early with a budget stop that judges nothing
     * and spends no acceptance budget.
     */
    goalVerificationBudgetSeconds?: Volatile<number>;
}
/**
 * Continuable-subagent provider for fresh teammates, matching the Agent Teams
 * tool plugin's own `freshProvider` default.
 */
export declare const DEFAULT_TEAM_PROVIDER = "spawn";
/**
 * Profile-patch shape of {@link Config}: what the Host validates the row's
 * config against, before the schema turns volatile fields into live references
 * and applies defaults. Declared separately because the two sides no longer
 * share one shape, so the schema is annotated `z<ConfigInput, Config>` — the
 * same split `dsh-git-graph` uses. The annotation is also what keeps the
 * emitted declaration portable: an unannotated schema holding a nested object
 * array infers a type that cannot be named without reaching into a transitive
 * dependency's own types.
 */
export interface ConfigInput {
    /** Announce the board in the system prompt. */
    announceToAgent?: boolean;
    /** Master switch for the plugin. */
    enabled?: boolean;
    /** Prevent idle system sleep while sessions run or schedules are armed. */
    preventIdleSleep?: boolean;
    /** Canonical reverse-proxy Host authorities. */
    trustedProxyHosts?: string[];
    /** Environment variable whose value the authenticated proxy injects. */
    proxyTokenEnv?: string;
    /** Explicit baseline for the permission confirmation gate; unset follows the Host default. */
    sessionDefaultPermission?: TaskPermission;
    /** Subtask depth limit, 1..3. */
    maxSubtaskDepth?: number;
    /** Roster-poll cadence in seconds while the board has work to reconcile. */
    sessionPollSeconds?: number;
    /** Concurrent run launches allowed at once, 1..16. */
    runLaunchWidth?: number;
    /** Daily token ceiling for board runs; 0 disables the gate. */
    spendBudgetTokens?: number;
    /** Continuable-subagent provider the Agent Teams service composes a teammate from. */
    teamProvider?: string;
    /** Global native /goal switch; default off, frozen per execution. */
    goalRunEnabled?: boolean;
    /** Agent preset a new card starts from; blank = not set. */
    cardDefaultMode?: string;
    /** Permission a new card starts from; blank = not set. */
    cardDefaultPermission?: TaskPermission | '';
    /** Model a new card starts from; blank = not set. */
    cardDefaultModel?: string;
    /** Reasoning level a new card starts from; blank = not set. */
    cardDefaultReasoningEffort?: string;
    /** Goal acceptance switch. */
    goalVerification?: boolean;
    /** Judge model route for goal acceptance; blank inherits the host default. */
    goalVerificationModel?: string;
    /** Judge reasoning effort; blank inherits the host default. */
    goalVerificationReasoningEffort?: string;
    /** Ceiling of one judge request of a goal acceptance, in seconds. */
    goalVerificationCallTimeoutSeconds?: number;
    /** Total ceiling of one goal acceptance attempt, in seconds. */
    goalVerificationBudgetSeconds?: number;
}
export declare const Config: z<ConfigInput, Config>;
/** Schema default for the goal-acceptance switch, re-read for hand-built contexts. */
export declare const DEFAULT_GOAL_VERIFICATION = true;
/**
 * Schema default for the GLOBAL native-/goal switch, re-read for hand-built
 * contexts. Deliberately false: a deployment that never configured it (and
 * every card written before the option existed) runs plain single turns.
 */
export declare const DEFAULT_GOAL_RUN = false;
declare module '@deepseek-ai/cordis' {
    interface Events {
        /**
         * Volatile config values were committed into the running fiber without a
         * remount; dispatched to the owning fiber only. Spelled here because the
         * Loader package is not a dependency of this plugin, with the Loader's own
         * shape so the two declarations merge when a Host program carries both.
         * @param paths - changed config paths as key arrays; every value is committed before dispatch.
         * @mode emit
         */
        'loader/volatile-update'(paths: readonly (readonly string[])[]): void;
    }
}
/**
 * Read one config field's current value.
 *
 * The Loader hands schema-volatile fields as stable references it commits in
 * place, so a live value must be read at use time rather than captured when
 * the plugin activates; a plain value (a programmatic mount, or a field the
 * schema does not mark volatile) is returned as it stands.
 * @param field - the config field as the Loader handed it.
 * @param fallback - value to use when the field is absent.
 * @returns the effective field value.
 */
export declare function readConfigField<T>(field: Volatile<T> | T | undefined, fallback: T): T;
/** Resolve proxy access without ever placing the token value in plugin config. */
export declare function resolveProxyAccess(config: Config | undefined, env?: NodeJS.ProcessEnv): {
    trustedProxyHosts: string[];
    proxyToken?: string;
};
/** The registry face the agent tools register into. */
interface AgentToolRegistry {
    register(definition: ToolDefinition): () => void;
    /** Scoped lookup; present on the real registry, absent on a stub that only registers. */
    get?(name: string, scope?: unknown): unknown;
}
/**
 * Resolve the optional agent-tool registry. The board deliberately does not
 * inject it: a deployment whose runtime serves no registry must still mount the
 * whole board and lose only the agent-tool surface, the same tolerance the
 * optional llm service gets.
 * @param ctx - the plugin context.
 * @returns the registry, or undefined when this deployment serves none.
 */
export declare function resolveToolRegistry(ctx: Context): AgentToolRegistry | undefined;
/**
 * Resolve the native cordis timer service (dsh-base's own `cordis-plugin-timer`
 * row). The board arms its schedule through it so unloading the row clears
 * every pending timer with the owning fiber, instead of the row tracking raw
 * process handles by hand. A composition that serves no timer service keeps
 * working on the process globals.
 * @param ctx - the plugin context.
 * @returns the timer face, or undefined when this deployment serves none.
 */
export declare function resolveHostTimers(ctx: Context): HostTimerFace | undefined;
/**
 * The Host's own default permission preset, mapped into the board's vocabulary.
 *
 * This is the value new DSH sessions start at (the deployment's `permission`
 * settings row), so a board that follows it treats an ordinary card exactly as
 * the Host would. Absent when the deployment serves no permission catalog, or
 * its default is a current-session identity (`auto`) that names no fixed
 * sandbox mode; the caller then keeps the fail-safe baseline.
 * @param ctx - the plugin context.
 * @returns the Host default as a board permission, or undefined when unreadable.
 */
export declare function resolveHostDefaultPermission(ctx: Context): TaskPermission | undefined;
/** The subset of the Agent Teams service this plugin drives. */
interface AgentTeamsFace {
    spawnTeammate(caller: unknown, request: {
        name: string;
        description: string;
        prompt: Array<{
            type: 'text';
            text: string;
        }>;
        context: 'fresh' | 'fork';
        provider: string;
        signal: AbortSignal;
    }): Promise<{
        member?: {
            id?: string;
            phase?: string;
            error?: string;
        };
    }>;
}
/**
 * Resolve the optional Agent Teams service. Like the tool registry and the llm
 * runtime, it is deliberately not injected: a deployment without Agent Teams
 * must still mount the whole board and only lose team-mode runs.
 * @param ctx - the plugin context.
 * @returns the service, or undefined when this deployment serves none.
 */
export declare function resolveAgentTeams(ctx: Context): AgentTeamsFace | undefined;
/**
 * Build the team dispatcher: the run's Lead session spawns one teammate per
 * subtask through the Agent Teams service, and the teammate's session id is
 * attached to that subtask's execution so the ordinary session monitor settles
 * it. Returns undefined when the deployment serves no Agent Teams service or
 * no live-agent registry, which makes a team run fail closed.
 * @param ctx - the plugin context.
 * @param provider - the continuable-subagent provider for fresh teammates.
 * @returns the dispatcher, or undefined when team runs cannot be served.
 */
export declare function buildTeamDispatcher(ctx: Context, provider: string): TaskBoardTeamDispatcher | undefined;
/**
 * Read the optional `llm` service. The board deliberately does not inject it:
 * a deployment without a model must still mount the board, and the parse route
 * answers a typed failure instead of the plugin failing to load (issue #1540).
 * @param ctx - the plugin context.
 * @returns the llm service, or undefined when this deployment serves none.
 */
export declare function resolveLlmRuntime(ctx: Context): LlmRuntime | undefined;
/**
 * The subset of `sessionController` the board uses to wake a cold persisted
 * session before running a slash command on it (issue #1861).
 */
interface SessionControllerFace {
    resolveAgent(sessionId: Parameters<Context['agents']['get']>[0]): Promise<{
        readonly agent: Parameters<Context['commands']['execute']>[0];
    } | {
        readonly error: {
            readonly message?: string;
        };
    }>;
}
/**
 * Resolve the optional `sessionController` service. Like the tool registry and
 * the llm runtime, it is read dynamically so capture-only test contexts that do
 * not mount the full session controller still activate the board.
 * @param ctx - the plugin context.
 * @returns the session controller face, or undefined when unavailable.
 */
export declare function resolveSessionController(ctx: Context): SessionControllerFace | undefined;
/**
 * Resolve the live Agent for an execution session, resuming a cold persisted
 * session through `sessionController.resolveAgent` when it is not yet in
 * `ctx.agents` (issue #1861).
 *
 * A fresh run (`session/create`) or a session the browser is currently
 * following is already in `ctx.agents`, so the fast path returns immediately.
 * A scheduled or manual reuse of a cold session — one that `session/list`
 * reports as idle from disk without activating its Agent — is not in
 * `ctx.agents` when `pinAndPrompt` runs `/permission` ahead of
 * `session/selectModel` and `session/prompt`; delegating to
 * `sessionController.resolveAgent` resumes it with its recorded preset and
 * model-selection state, matching what those gateway endpoints do next.
 * @param ctx - the plugin context.
 * @param sessionId - the target execution session id.
 * @returns the live Agent for `sessionId`.
 */
export declare function resolveExecutionAgent(ctx: Context, sessionId: Parameters<Context['agents']['get']>[0]): Promise<Parameters<Context['commands']['execute']>[0]>;
/**
 * Activate the board's host half: ledger, routes, cron scheduler, power
 * inhibitor, and the model-facing announcement.
 *
 * The effective settings are the config the Host hands this row. The fields
 * the browser card edits are schema-volatile, so the Loader commits an
 * edit into the running fiber's references instead of remounting the row —
 * `sync` therefore reads them at use time and follows
 * `loader/volatile-update`, the event the Loader emits once it has committed
 * them. Every other field reloads the row, which re-runs this activation.
 * @param ctx - the plugin context (systemPrompt injected).
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export declare const apply: typeof applyImpl;
declare function applyImpl(ctx: Context, config?: Config): void;
export {};
