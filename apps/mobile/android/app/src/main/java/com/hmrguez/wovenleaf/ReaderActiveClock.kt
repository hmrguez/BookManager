package com.hmrguez.wovenleaf

/** Completed foreground slices only; an interrupted process never invents its tail. */
internal data class ReaderActiveInterval(
    val startedAtMs: Long, val endedAtMs: Long, val index: Int,
    val startReason: String, val endReason: String,
)

internal class ReaderActiveClock {
    companion object { const val CHECKPOINT_MS = 10_000L }
    private var wall: Long? = null
    private var monotonic = 0L
    private var index = 0
    private var nextReason = "open"

    fun resume(wallMs: Long, monotonicMs: Long) {
        if (wall != null) return
        wall = wallMs
        monotonic = monotonicMs
    }

    fun flush(wallMs: Long, monotonicMs: Long, reason: String): ReaderActiveInterval? {
        val start = wall ?: return null
        val elapsed = monotonicMs - monotonic
        val supported = elapsed in 0..30_000 && kotlin.math.abs(wallMs - start - elapsed) <= 250
        val result = if (supported) ReaderActiveInterval(
            start, start + elapsed, index, nextReason, reason,
        ) else null
        index += 1
        wall = if (reason == "checkpoint") (if (supported) start + elapsed else wallMs) else null
        monotonic = monotonicMs
        nextReason = if (supported) (if (reason == "checkpoint") "checkpoint" else "resume") else "discontinuity"
        return result
    }
}
