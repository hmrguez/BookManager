package com.hmrguez.wovenleaf

import org.junit.Assert.*
import org.junit.Test

class ReaderActiveClockTest {
    @Test fun pausesDuplicatesBoundariesAndProcessDeath() {
        val clock = ReaderActiveClock()
        assertNull(clock.flush(0, 0, "pause"))
        clock.resume(0, 0)
        clock.resume(5000, 5000) // duplicate resume cannot restart the clock
        assertEquals(ReaderActiveInterval(0, 10000, 0, "open", "checkpoint"), clock.flush(10000, 10000, "checkpoint"))
        assertEquals(ReaderActiveInterval(10000, 12000, 1, "checkpoint", "pause"), clock.flush(12000, 12000, "pause"))
        assertNull(clock.flush(13000, 13000, "pause"))
        clock.resume(312000, 312000) // exactly five minutes; the gap is preserved, never added
        assertEquals(ReaderActiveInterval(312000, 322000, 2, "resume", "close"), clock.flush(322000, 322000, "close"))
        val reopened = ReaderActiveClock()
        reopened.resume(622001, 622001) // longer break remains distinguishable
        assertEquals(ReaderActiveInterval(622001, 632001, 0, "open", "checkpoint"), reopened.flush(632001, 632001, "checkpoint"))
        // Simulate death: only the completed slice survives. A new clock cannot finish its tail.
        assertNull(ReaderActiveClock().flush(900000, 900000, "close"))
    }

    @Test fun clockChangesAndSuspensionCannotEarnTime() {
        val clock = ReaderActiveClock()
        clock.resume(0, 0)
        assertNull(clock.flush(5000, 10000, "checkpoint"))
        assertEquals(ReaderActiveInterval(5000, 15000, 1, "discontinuity", "checkpoint"), clock.flush(15000, 20000, "checkpoint"))
        assertNull(clock.flush(55000, 60000, "checkpoint"))
        assertEquals("discontinuity", clock.flush(65000, 70000, "pause")!!.startReason)
        clock.resume(70000, 80000)
        assertNull(clock.flush(69000, 79000, "close"))
    }
}
