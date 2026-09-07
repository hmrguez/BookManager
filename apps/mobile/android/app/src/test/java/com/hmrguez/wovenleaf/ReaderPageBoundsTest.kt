package com.hmrguez.wovenleaf

import org.junit.Assert.assertEquals
import org.junit.Test

class ReaderPageBoundsTest {
    @Test fun lastVisiblePageCompletesWithoutAnExtraTurn() {
        assertEquals(ReaderPageBounds(atStart = true), ReaderPageBounds.forPage(0, 50, false))
        assertEquals(ReaderPageBounds(), ReaderPageBounds.forPage(48, 50, false))
        assertEquals(ReaderPageBounds(atEnd = true), ReaderPageBounds.forPage(49, 50, false))
        // Turning back from the final page clears completion.
        assertEquals(ReaderPageBounds(), ReaderPageBounds.forPage(48, 50, false))
    }

    @Test fun rtlUsesTheOppositePhysicalEdges() {
        assertEquals(ReaderPageBounds(atStart = true), ReaderPageBounds.forPage(49, 50, true))
        assertEquals(ReaderPageBounds(), ReaderPageBounds.forPage(1, 50, true))
        assertEquals(ReaderPageBounds(atEnd = true), ReaderPageBounds.forPage(0, 50, true))
    }

    @Test fun singlePageResourcesHaveBothEdges() {
        for (rtl in listOf(false, true)) {
            assertEquals(ReaderPageBounds(true, true), ReaderPageBounds.forPage(0, 1, rtl))
        }
    }

    @Test fun unlaidOutAndInvalidPagesCannotCompleteABook() {
        for ((index, count) in listOf(0 to 0, -1 to 50, 50 to 50)) {
            assertEquals(ReaderPageBounds(), ReaderPageBounds.forPage(index, count, false))
        }
    }
}
