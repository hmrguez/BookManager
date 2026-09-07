package com.hmrguez.wovenleaf

internal data class ReaderPageBounds(val atStart: Boolean = false, val atEnd: Boolean = false) {
    companion object {
        // Readium reports zero-based physical page indices, even in RTL books.
        fun forPage(index: Int, count: Int, rightToLeft: Boolean): ReaderPageBounds {
            if (count <= 0 || index !in 0 until count) return ReaderPageBounds()
            return ReaderPageBounds(
                atStart = index == if (rightToLeft) count - 1 else 0,
                atEnd = index == if (rightToLeft) 0 else count - 1,
            )
        }
    }
}
