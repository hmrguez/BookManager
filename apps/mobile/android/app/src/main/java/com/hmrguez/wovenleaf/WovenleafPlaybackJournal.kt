package com.hmrguez.wovenleaf

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject

internal class WovenleafPlaybackJournal(context: Context) :
    SQLiteOpenHelper(context, "wovenleaf-playback-journal-v1.sqlite", null, 1) {

    init {
        setWriteAheadLoggingEnabled(true)
    }

    override fun onConfigure(database: SQLiteDatabase) {
        database.setForeignKeyConstraintsEnabled(true)
        database.execSQL("PRAGMA synchronous=FULL")
    }

    override fun onCreate(database: SQLiteDatabase) {
        database.execSQL(
            """
            CREATE TABLE playback_state(
              key TEXT PRIMARY KEY NOT NULL,
              payload TEXT NOT NULL
            )
            """.trimIndent(),
        )
        database.execSQL(
            """
            CREATE TABLE playback_events(
              id TEXT PRIMARY KEY NOT NULL,
              sequence INTEGER NOT NULL,
              terminal INTEGER NOT NULL,
              payload TEXT NOT NULL
            )
            """.trimIndent(),
        )
        database.execSQL("CREATE INDEX playback_events_sequence ON playback_events(sequence, id)")
        database.execSQL(
            """
            CREATE TABLE playback_commands(
              id TEXT PRIMARY KEY NOT NULL,
              snapshot TEXT NOT NULL,
              applied_at TEXT NOT NULL
            )
            """.trimIndent(),
        )
    }

    override fun onUpgrade(database: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    @Synchronized
    fun saveState(payload: JSONObject) {
        writableDatabase.beginTransaction()
        try {
            writableDatabase.insertWithOnConflict(
                "playback_state",
                null,
                ContentValues().apply {
                    put("key", "active")
                    put("payload", payload.toString())
                },
                SQLiteDatabase.CONFLICT_REPLACE,
            )
            writableDatabase.setTransactionSuccessful()
        } finally {
            writableDatabase.endTransaction()
        }
    }

    @Synchronized
    fun state(): JSONObject? = readableDatabase.rawQuery(
        "SELECT payload FROM playback_state WHERE key = 'active'",
        null,
    ).use { cursor ->
        if (cursor.moveToFirst()) runCatching { JSONObject(cursor.getString(0)) }.getOrNull() else null
    }

    @Synchronized
    fun enqueue(event: JSONObject, terminal: Boolean) {
        writableDatabase.beginTransaction()
        try {
            writableDatabase.insertWithOnConflict(
                "playback_events",
                null,
                ContentValues().apply {
                    put("id", event.getString("id"))
                    put("sequence", event.getLong("sequence"))
                    put("terminal", if (terminal) 1 else 0)
                    put("payload", event.toString())
                },
                SQLiteDatabase.CONFLICT_IGNORE,
            )
            writableDatabase.execSQL(
                """
                DELETE FROM playback_events
                WHERE terminal = 0 AND id IN (
                  SELECT id FROM playback_events
                  WHERE terminal = 0
                  ORDER BY sequence DESC, id DESC
                  LIMIT -1 OFFSET 1024
                )
                """.trimIndent(),
            )
            writableDatabase.setTransactionSuccessful()
        } finally {
            writableDatabase.endTransaction()
        }
    }

    @Synchronized
    fun events(): JSONArray = readableDatabase.rawQuery(
        "SELECT payload FROM playback_events ORDER BY sequence, id",
        null,
    ).use { cursor ->
        JSONArray().apply {
            while (cursor.moveToNext()) runCatching { put(JSONObject(cursor.getString(0))) }
        }
    }

    @Synchronized
    fun eventCount(): Int = readableDatabase.rawQuery(
        "SELECT COUNT(*) FROM playback_events",
        null,
    ).use { cursor -> if (cursor.moveToFirst()) cursor.getInt(0) else 0 }

    @Synchronized
    fun acknowledge(ids: Set<String>) {
        if (ids.isEmpty()) return
        writableDatabase.beginTransaction()
        try {
            ids.forEach { id -> writableDatabase.delete("playback_events", "id = ?", arrayOf(id)) }
            writableDatabase.setTransactionSuccessful()
        } finally {
            writableDatabase.endTransaction()
        }
    }

    @Synchronized
    fun recordCommand(id: String, snapshot: JSONObject, appliedAt: String) {
        writableDatabase.insertWithOnConflict(
            "playback_commands",
            null,
            ContentValues().apply {
                put("id", id)
                put("snapshot", snapshot.toString())
                put("applied_at", appliedAt)
            },
            SQLiteDatabase.CONFLICT_REPLACE,
        )
        writableDatabase.execSQL(
            """
            DELETE FROM playback_commands WHERE id IN (
              SELECT id FROM playback_commands ORDER BY applied_at DESC, id DESC LIMIT -1 OFFSET 256
            )
            """.trimIndent(),
        )
    }

    @Synchronized
    fun command(id: String): JSONObject? = readableDatabase.rawQuery(
        "SELECT snapshot FROM playback_commands WHERE id = ?",
        arrayOf(id),
    ).use { cursor ->
        if (cursor.moveToFirst()) runCatching { JSONObject(cursor.getString(0)) }.getOrNull() else null
    }
}
