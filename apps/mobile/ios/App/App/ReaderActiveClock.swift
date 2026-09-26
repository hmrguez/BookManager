import Foundation

/// Each emitted slice is wholly foreground time. Never recover an unfinished tail
/// from wall time after a crash. Callers persist slices before bridge delivery.
struct ReaderActiveInterval {
    let startedAtMs: Int64
    let endedAtMs: Int64
    let index: Int
    let startReason: String
    let endReason: String
}

struct ReaderActiveClock {
    static let checkpointSeconds: TimeInterval = 10
    private var wall: Int64?
    private var monotonic: Int64 = 0
    private var index = 0
    private var nextReason = "open"

    mutating func resume(wallMs: Int64, monotonicMs: Int64) {
        guard wall == nil else { return }
        wall = wallMs
        monotonic = monotonicMs
    }

    mutating func flush(wallMs: Int64, monotonicMs: Int64, reason: String) -> ReaderActiveInterval? {
        guard let start = wall else { return nil }
        let elapsed = monotonicMs - monotonic
        // A suspended/stalled callback or clock change cannot locate active time.
        let supported = elapsed >= 0 && elapsed <= 30_000 && abs(wallMs - start - elapsed) <= 250
        let result = supported ? ReaderActiveInterval(
            startedAtMs: start, endedAtMs: start + elapsed, index: index,
            startReason: nextReason, endReason: reason
        ) : nil
        index += 1
        wall = reason == "checkpoint" ? (supported ? start + elapsed : wallMs) : nil
        monotonic = monotonicMs
        nextReason = supported ? (reason == "checkpoint" ? "checkpoint" : "resume") : "discontinuity"
        return result
    }
}
