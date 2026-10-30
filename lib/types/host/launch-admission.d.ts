/**
 * Admission control for the session-creating half of a run.
 *
 * One board action can open a whole subtree, and a team run hands every member
 * of it to the Lead at once. Both paths used to fire every launch in the same
 * tick, so the Host asked DSH for N sessions at once — the burst the repository's
 * measured guidance caps at three heavy implementation subagents
 * (docs/multi-agent-resources.md), with no mechanism enforcing it.
 *
 * The queue is SERVICE-wide, not per run group: the pressure it bounds is the
 * machine's (the Host process's memory and the swap it drives), and two run
 * groups opened from two tabs share one Host. Admission is round-robin across
 * run groups — FIFO inside a group, so a group's first run (the Lead, which
 * carries the run shape and the teammate namespace) always starts before its
 * members — so a large subtree cannot starve a run opened after it, and no
 * entry can be starved.
 *
 * The width is read through a live callback, so a settings edit takes effect on
 * the next admission without remounting anything.
 *
 * @module dsh-task-board/host/launch-admission
 */
/** One launch the queue has not started yet. */
export interface QueuedLaunch {
    /** Run group this launch belongs to; the unit of round-robin fairness. */
    readonly groupId: string;
    /**
     * Perform the launch. The slot is held until this promise settles, which
     * makes "in flight" mean "still creating and prompting its session".
     * A rejection is swallowed here so one broken launch can never wedge the
     * slot; the caller owns reporting.
     */
    start(): Promise<void>;
    /**
     * Called by {@link LaunchAdmissionQueue.drain} for a launch that never
     * started, so the caller can take its execution out of the running column.
     */
    abandon(): void;
}
export declare class LaunchAdmissionQueue {
    private readonly width;
    /** Waiting launches per run group, in arrival order. */
    private readonly waiting;
    /** Run groups in round-robin order. */
    private rotation;
    /** Slot holders of the launches in flight, one per admitted launch. */
    private readonly inFlight;
    /** Highest number of launches in flight at once; observability and tests. */
    peakInFlight: number;
    /**
     * @param width - live admission width (already normalized by the caller).
     */
    constructor(width: () => number);
    /** Launches the queue has not admitted yet. */
    get pendingCount(): number;
    /** Launches currently holding a slot. */
    get inFlightCount(): number;
    /** Admit one launch, immediately if a slot is free. */
    enqueue(launch: QueuedLaunch): void;
    /**
     * Abandon every waiting launch: the queue is being torn down, so an entry
     * that never started can never start. Launches already in flight are left
     * alone — their session may already exist, and the callers that own them
     * settle them through the normal path.
     * @returns the abandoned launches, in abandonment order.
     */
    drain(): QueuedLaunch[];
    private pump;
    /** The next launch by round-robin across groups and FIFO inside one. */
    private takeNext;
    private admit;
}
