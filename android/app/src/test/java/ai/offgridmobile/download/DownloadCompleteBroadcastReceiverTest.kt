package ai.offgridmobile.download

import android.app.Application
import android.app.DownloadManager
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.database.Cursor
import androidx.test.core.app.ApplicationProvider
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.kotlin.any
import org.mockito.kotlin.mock
import org.mockito.kotlin.verifyNoInteractions
import org.mockito.kotlin.whenever
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Unit tests for DownloadCompleteBroadcastReceiver.
 *
 * Strategy:
 * - Robolectric: real Intent, SharedPreferences, and DownloadManager.Query construction
 * - Mockito: mocked DownloadManager injected via a ContextWrapper so query() results
 *   are fully controlled without needing a live download in progress
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = Application::class)
class DownloadCompleteBroadcastReceiverTest {

    private lateinit var context: Context
    private lateinit var mockDownloadManager: DownloadManager
    private val receiver = DownloadCompleteBroadcastReceiver()

    @Before
    fun setUp() {
        mockDownloadManager = mock()
        // Wrap the Robolectric application context so getSystemService(DOWNLOAD_SERVICE)
        // returns our Mockito mock while SharedPreferences remain fully functional.
        context = object : ContextWrapper(ApplicationProvider.getApplicationContext<Application>()) {
            override fun getSystemService(name: String): Any? =
                if (name == Context.DOWNLOAD_SERVICE) mockDownloadManager
                else super.getSystemService(name)
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private fun setTrackedDownloads(vararg downloadIds: Long) {
        val array = JSONArray()
        downloadIds.forEach { id -> array.put(JSONObject().put("downloadId", id)) }
        prefs().edit().putString(DownloadManagerModule.DOWNLOADS_KEY, array.toString()).apply()
    }

    private fun getSavedDownload(index: Int = 0): JSONObject {
        val json = prefs().getString(DownloadManagerModule.DOWNLOADS_KEY, "[]") ?: "[]"
        return JSONArray(json).getJSONObject(index)
    }

    private fun prefs() =
        context.getSharedPreferences(DownloadManagerModule.PREFS_NAME, Context.MODE_PRIVATE)

    private fun makeIntent(
        action: String = DownloadManager.ACTION_DOWNLOAD_COMPLETE,
        downloadId: Long = 42L,
    ): Intent = Intent(action).apply {
        putExtra(DownloadManager.EXTRA_DOWNLOAD_ID, downloadId)
    }

    /**
     * Returns a mock Cursor that reports a single row with the given status/localUri/reason.
     * Column indices 0/1/2 map to STATUS/LOCAL_URI/REASON respectively.
     */
    private fun makeCursor(
        status: Int,
        localUri: String? = "file:///sdcard/test.bin",
        reason: Int = 0,
    ): Cursor = mock<Cursor>().also {
        whenever(it.moveToFirst()).thenReturn(true)
        whenever(it.getColumnIndex(DownloadManager.COLUMN_STATUS)).thenReturn(0)
        whenever(it.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI)).thenReturn(1)
        whenever(it.getColumnIndex(DownloadManager.COLUMN_REASON)).thenReturn(2)
        whenever(it.getInt(0)).thenReturn(status)
        whenever(it.getString(1)).thenReturn(localUri)
        whenever(it.getInt(2)).thenReturn(reason)
    }

    // ── Guard clause tests ────────────────────────────────────────────────────

    @Test
    fun `ignores intent with wrong action`() {
        setTrackedDownloads(42L)
        receiver.onReceive(context, makeIntent(action = "wrong.action"))
        verifyNoInteractions(mockDownloadManager)
    }

    @Test
    fun `ignores intent without download id extra`() {
        setTrackedDownloads(42L)
        receiver.onReceive(context, Intent(DownloadManager.ACTION_DOWNLOAD_COMPLETE))
        verifyNoInteractions(mockDownloadManager)
    }

    @Test
    fun `ignores download id that is not in tracked list`() {
        setTrackedDownloads(42L)
        receiver.onReceive(context, makeIntent(downloadId = 99L))
        verifyNoInteractions(mockDownloadManager)
    }

    @Test
    fun `handles corrupt JSON in SharedPreferences without crashing`() {
        prefs().edit().putString(DownloadManagerModule.DOWNLOADS_KEY, "not-json").apply()
        receiver.onReceive(context, makeIntent())
        verifyNoInteractions(mockDownloadManager)
    }

    // ── Successful download ───────────────────────────────────────────────────

    @Test
    fun `marks successful download as completed and persists to SharedPreferences`() {
        setTrackedDownloads(42L)
        val cursor = makeCursor(DownloadManager.STATUS_SUCCESSFUL, localUri = "file:///sdcard/model.bin")
        whenever(mockDownloadManager.query(any())).thenReturn(cursor)

        receiver.onReceive(context, makeIntent(downloadId = 42L))

        val saved = getSavedDownload()
        assertEquals("completed", saved.getString("status"))
        assertEquals("file:///sdcard/model.bin", saved.getString("localUri"))
        assertTrue(saved.has("completedAt"))
    }

    @Test
    fun `uses empty string for localUri when it is null on success`() {
        setTrackedDownloads(42L)
        val cursor = makeCursor(DownloadManager.STATUS_SUCCESSFUL, localUri = null)
        whenever(mockDownloadManager.query(any())).thenReturn(cursor)

        receiver.onReceive(context, makeIntent(downloadId = 42L))

        assertEquals("", getSavedDownload().getString("localUri"))
    }

    // ── Failed download ───────────────────────────────────────────────────────

    @Test
    fun `marks failed download with human-readable reason and persists`() {
        setTrackedDownloads(42L)
        val cursor = makeCursor(DownloadManager.STATUS_FAILED, reason = DownloadManager.ERROR_INSUFFICIENT_SPACE)
        whenever(mockDownloadManager.query(any())).thenReturn(cursor)

        receiver.onReceive(context, makeIntent(downloadId = 42L))

        val saved = getSavedDownload()
        assertEquals("failed", saved.getString("status"))
        assertEquals("Insufficient space", saved.getString("failureReason"))
        assertTrue(saved.has("completedAt"))
    }

    @Test
    fun `includes completedAt timestamp for failed download`() {
        val before = System.currentTimeMillis()
        setTrackedDownloads(42L)
        val cursor = makeCursor(DownloadManager.STATUS_FAILED, reason = DownloadManager.ERROR_UNKNOWN)
        whenever(mockDownloadManager.query(any())).thenReturn(cursor)

        receiver.onReceive(context, makeIntent(downloadId = 42L))

        val completedAt = getSavedDownload().getLong("completedAt")
        assertTrue(completedAt >= before)
    }

    // ── Cursor edge cases ─────────────────────────────────────────────────────

    @Test
    fun `does not update SharedPreferences when cursor is null`() {
        setTrackedDownloads(42L)
        whenever(mockDownloadManager.query(any())).thenReturn(null)

        receiver.onReceive(context, makeIntent(downloadId = 42L))

        assertFalse(getSavedDownload().has("status"))
    }

    @Test
    fun `does not update SharedPreferences when cursor has no rows`() {
        setTrackedDownloads(42L)
        val emptyCursor: Cursor = mock()
        whenever(emptyCursor.moveToFirst()).thenReturn(false)
        whenever(mockDownloadManager.query(any())).thenReturn(emptyCursor)

        receiver.onReceive(context, makeIntent(downloadId = 42L))

        assertFalse(getSavedDownload().has("status"))
    }

    // ── Multi-download list integrity ─────────────────────────────────────────

    @Test
    fun `only updates the matching download and leaves others unchanged`() {
        setTrackedDownloads(11L, 42L, 99L)
        val cursor = makeCursor(DownloadManager.STATUS_SUCCESSFUL)
        whenever(mockDownloadManager.query(any())).thenReturn(cursor)

        receiver.onReceive(context, makeIntent(downloadId = 42L))

        assertFalse("download at index 0 should be untouched", getSavedDownload(0).has("status"))
        assertEquals("completed", getSavedDownload(1).getString("status"))
        assertFalse("download at index 2 should be untouched", getSavedDownload(2).has("status"))
    }
}
