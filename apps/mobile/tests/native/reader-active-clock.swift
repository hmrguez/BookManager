import Foundation

@main struct ActiveClockTests {
    static func main() {
        var clock = ReaderActiveClock()
        precondition(clock.flush(wallMs: 0, monotonicMs: 0, reason: "pause") == nil)
        clock.resume(wallMs: 0, monotonicMs: 0)
        clock.resume(wallMs: 5_000, monotonicMs: 5_000)
        let first = clock.flush(wallMs: 10_000, monotonicMs: 10_000, reason: "checkpoint")!
        precondition(first.startedAtMs == 0 && first.endedAtMs == 10_000 && first.index == 0)
        let paused = clock.flush(wallMs: 12_000, monotonicMs: 12_000, reason: "pause")!
        precondition(paused.startedAtMs == 10_000 && paused.endedAtMs == 12_000)
        precondition(clock.flush(wallMs: 13_000, monotonicMs: 13_000, reason: "pause") == nil)
        clock.resume(wallMs: 312_000, monotonicMs: 312_000)
        let resumed = clock.flush(wallMs: 322_000, monotonicMs: 322_000, reason: "close")!
        precondition(resumed.startedAtMs - paused.endedAtMs == 300_000)
        precondition(resumed.endedAtMs - resumed.startedAtMs == 10_000 && resumed.startReason == "resume")
        var reopened = ReaderActiveClock()
        reopened.resume(wallMs: 622_001, monotonicMs: 622_001)
        precondition(reopened.flush(wallMs: 632_001, monotonicMs: 632_001, reason: "checkpoint")!.startReason == "open")
        var afterCrash = ReaderActiveClock()
        precondition(afterCrash.flush(wallMs: 900_000, monotonicMs: 900_000, reason: "close") == nil)
        var unreliable = ReaderActiveClock()
        unreliable.resume(wallMs: 0, monotonicMs: 0)
        precondition(unreliable.flush(wallMs: 5_000, monotonicMs: 10_000, reason: "checkpoint") == nil)
        precondition(unreliable.flush(wallMs: 15_000, monotonicMs: 20_000, reason: "checkpoint")!.startReason == "discontinuity")
        precondition(unreliable.flush(wallMs: 55_000, monotonicMs: 60_000, reason: "checkpoint") == nil)
        precondition(unreliable.flush(wallMs: 65_000, monotonicMs: 70_000, reason: "pause")!.startReason == "discontinuity")
        print("Swift foreground capture: lifecycle, duplicates, five-minute boundary, crash tail and clock anomalies passed")
    }
}
