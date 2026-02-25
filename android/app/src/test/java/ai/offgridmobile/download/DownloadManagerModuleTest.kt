package ai.offgridmobile.download

import android.app.Application
import android.app.DownloadManager
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Tests for the pure helper functions in DownloadManagerModule.
 * These functions contain complex branching logic and all branches must be covered.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = Application::class)
class DownloadManagerModuleTest {

    // ── statusToString ────────────────────────────────────────────────────────

    @Test
    fun `statusToString maps STATUS_PENDING to pending`() {
        assertEquals("pending", DownloadManagerModule.statusToString(DownloadManager.STATUS_PENDING))
    }

    @Test
    fun `statusToString maps STATUS_RUNNING to running`() {
        assertEquals("running", DownloadManagerModule.statusToString(DownloadManager.STATUS_RUNNING))
    }

    @Test
    fun `statusToString maps STATUS_PAUSED to paused`() {
        assertEquals("paused", DownloadManagerModule.statusToString(DownloadManager.STATUS_PAUSED))
    }

    @Test
    fun `statusToString maps STATUS_SUCCESSFUL to completed`() {
        assertEquals("completed", DownloadManagerModule.statusToString(DownloadManager.STATUS_SUCCESSFUL))
    }

    @Test
    fun `statusToString maps STATUS_FAILED to failed`() {
        assertEquals("failed", DownloadManagerModule.statusToString(DownloadManager.STATUS_FAILED))
    }

    @Test
    fun `statusToString returns unknown for unrecognized status`() {
        assertEquals("unknown", DownloadManagerModule.statusToString(-99))
        assertEquals("unknown", DownloadManagerModule.statusToString(0))
    }

    // ── reasonToString — paused ───────────────────────────────────────────────

    @Test
    fun `reasonToString maps PAUSED_QUEUED_FOR_WIFI when status is paused`() {
        assertEquals(
            "Waiting for WiFi",
            DownloadManagerModule.reasonToString(
                DownloadManager.STATUS_PAUSED,
                DownloadManager.PAUSED_QUEUED_FOR_WIFI,
            ),
        )
    }

    @Test
    fun `reasonToString maps PAUSED_WAITING_FOR_NETWORK when status is paused`() {
        assertEquals(
            "Waiting for network",
            DownloadManagerModule.reasonToString(
                DownloadManager.STATUS_PAUSED,
                DownloadManager.PAUSED_WAITING_FOR_NETWORK,
            ),
        )
    }

    @Test
    fun `reasonToString maps PAUSED_WAITING_TO_RETRY when status is paused`() {
        assertEquals(
            "Waiting to retry",
            DownloadManagerModule.reasonToString(
                DownloadManager.STATUS_PAUSED,
                DownloadManager.PAUSED_WAITING_TO_RETRY,
            ),
        )
    }

    @Test
    fun `reasonToString returns generic Paused for unknown pause reason`() {
        assertEquals(
            "Paused",
            DownloadManagerModule.reasonToString(DownloadManager.STATUS_PAUSED, -99),
        )
    }

    // ── reasonToString — failed ───────────────────────────────────────────────

    @Test
    fun `reasonToString maps ERROR_CANNOT_RESUME when status is failed`() {
        assertEquals(
            "Cannot resume",
            DownloadManagerModule.reasonToString(
                DownloadManager.STATUS_FAILED,
                DownloadManager.ERROR_CANNOT_RESUME,
            ),
        )
    }

    @Test
    fun `reasonToString maps ERROR_DEVICE_NOT_FOUND when status is failed`() {
        assertEquals(
            "Device not found",
            DownloadManagerModule.reasonToString(
                DownloadManager.STATUS_FAILED,
                DownloadManager.ERROR_DEVICE_NOT_FOUND,
            ),
        )
    }

    @Test
    fun `reasonToString maps ERROR_FILE_ALREADY_EXISTS when status is failed`() {
        assertEquals(
            "File already exists",
            DownloadManagerModule.reasonToString(
                DownloadManager.STATUS_FAILED,
                DownloadManager.ERROR_FILE_ALREADY_EXISTS,
            ),
        )
    }

    @Test
    fun `reasonToString maps ERROR_FILE_ERROR when status is failed`() {
        assertEquals(
            "File error",
            DownloadManagerModule.reasonToString(
                DownloadManager.STATUS_FAILED,
                DownloadManager.ERROR_FILE_ERROR,
            ),
        )
    }

    @Test
    fun `reasonToString maps ERROR_HTTP_DATA_ERROR when status is failed`() {
        assertEquals(
            "HTTP data error",
            DownloadManagerModule.reasonToString(
                DownloadManager.STATUS_FAILED,
                DownloadManager.ERROR_HTTP_DATA_ERROR,
            ),
        )
    }

    @Test
    fun `reasonToString maps ERROR_INSUFFICIENT_SPACE when status is failed`() {
        assertEquals(
            "Insufficient space",
            DownloadManagerModule.reasonToString(
                DownloadManager.STATUS_FAILED,
                DownloadManager.ERROR_INSUFFICIENT_SPACE,
            ),
        )
    }

    @Test
    fun `reasonToString maps ERROR_TOO_MANY_REDIRECTS when status is failed`() {
        assertEquals(
            "Too many redirects",
            DownloadManagerModule.reasonToString(
                DownloadManager.STATUS_FAILED,
                DownloadManager.ERROR_TOO_MANY_REDIRECTS,
            ),
        )
    }

    @Test
    fun `reasonToString maps ERROR_UNHANDLED_HTTP_CODE when status is failed`() {
        assertEquals(
            "Unhandled HTTP code",
            DownloadManagerModule.reasonToString(
                DownloadManager.STATUS_FAILED,
                DownloadManager.ERROR_UNHANDLED_HTTP_CODE,
            ),
        )
    }

    @Test
    fun `reasonToString maps ERROR_UNKNOWN when status is failed`() {
        assertEquals(
            "Unknown error",
            DownloadManagerModule.reasonToString(
                DownloadManager.STATUS_FAILED,
                DownloadManager.ERROR_UNKNOWN,
            ),
        )
    }

    @Test
    fun `reasonToString includes error code for unrecognized failure reason`() {
        assertEquals(
            "Error: 999",
            DownloadManagerModule.reasonToString(DownloadManager.STATUS_FAILED, 999),
        )
    }

    // ── reasonToString — other statuses ──────────────────────────────────────

    @Test
    fun `reasonToString returns empty string when status is not paused or failed`() {
        assertEquals("", DownloadManagerModule.reasonToString(DownloadManager.STATUS_PENDING, 0))
        assertEquals("", DownloadManagerModule.reasonToString(DownloadManager.STATUS_RUNNING, 0))
        assertEquals("", DownloadManagerModule.reasonToString(DownloadManager.STATUS_SUCCESSFUL, 0))
    }

    // ── shouldRemoveDownload ──────────────────────────────────────────────────
    //
    // Entries are only pruned after moveCompletedDownload sets moveCompleted=true.
    // Time-based removal alone caused downloads to vanish while the phone was
    // sleeping — the JS side couldn't call moveCompletedDownload in time.

    private fun download(
        storedStatus: String = "pending",
        completedAt: Long = 0L,
        completedEventSent: Boolean = false,
        moveCompleted: Boolean = false,
    ) = JSONObject()
        .put("downloadId", 42L)
        .put("status", storedStatus)
        .put("completedAt", completedAt)
        .put("completedEventSent", completedEventSent)
        .put("moveCompleted", moveCompleted)

    @Test
    fun `shouldRemoveDownload returns true when live status is unknown`() {
        assertTrue(DownloadManagerModule.shouldRemoveDownload(download("running"), liveStatus = "unknown"))
    }

    @Test
    fun `shouldRemoveDownload returns false for active downloads`() {
        assertFalse(DownloadManagerModule.shouldRemoveDownload(download("running"), liveStatus = "running"))
        assertFalse(DownloadManagerModule.shouldRemoveDownload(download("pending"), liveStatus = "pending"))
    }

    @Test
    fun `shouldRemoveDownload removes completed download when move confirmed and older than 5 seconds`() {
        val now = System.currentTimeMillis()
        val dl = download("completed", completedAt = now - 6_000L, completedEventSent = true, moveCompleted = true)
        assertTrue(DownloadManagerModule.shouldRemoveDownload(dl, liveStatus = "completed", currentTimeMs = now))
    }

    @Test
    fun `shouldRemoveDownload keeps completed download when move confirmed but not yet 5 seconds old`() {
        val now = System.currentTimeMillis()
        val dl = download("completed", completedAt = now - 1_000L, completedEventSent = true, moveCompleted = true)
        assertFalse(DownloadManagerModule.shouldRemoveDownload(dl, liveStatus = "completed", currentTimeMs = now))
    }

    @Test
    fun `shouldRemoveDownload keeps completed download when event sent but move not confirmed`() {
        // Event sent is NOT enough — must wait for moveCompletedDownload to confirm
        val now = System.currentTimeMillis()
        val dl = download("completed", completedAt = now - 60_000L, completedEventSent = true, moveCompleted = false)
        assertFalse(DownloadManagerModule.shouldRemoveDownload(dl, liveStatus = "completed", currentTimeMs = now))
    }

    @Test
    fun `shouldRemoveDownload keeps completed download indefinitely until move is confirmed`() {
        // Even after 10 minutes, entry stays if moveCompleted is false
        val now = System.currentTimeMillis()
        val dl = download("completed", completedAt = now - 600_000L, completedEventSent = true, moveCompleted = false)
        assertFalse(DownloadManagerModule.shouldRemoveDownload(dl, liveStatus = "completed", currentTimeMs = now))
    }

    @Test
    fun `shouldRemoveDownload keeps completed download when completedAt is zero`() {
        val now = System.currentTimeMillis()
        val dl = download("completed", completedAt = 0L, completedEventSent = true, moveCompleted = true)
        assertFalse(DownloadManagerModule.shouldRemoveDownload(dl, liveStatus = "completed", currentTimeMs = now))
    }

    @Test
    fun `shouldRemoveDownload returns false for non-completed stored status regardless of live status`() {
        val now = System.currentTimeMillis()
        val dl = download("running", completedAt = now - 10_000L, completedEventSent = true, moveCompleted = true)
        assertFalse(DownloadManagerModule.shouldRemoveDownload(dl, liveStatus = "running", currentTimeMs = now))
    }

    // ── shouldRemoveDownload — additional edge cases ─────────────────────────

    @Test
    fun `shouldRemoveDownload keeps paused download`() {
        assertFalse(DownloadManagerModule.shouldRemoveDownload(download("paused"), liveStatus = "paused"))
    }

    @Test
    fun `shouldRemoveDownload uses exactly 5000ms threshold — not yet expired`() {
        // t=10000, completedAt=5001 → age=4999ms — below threshold (move confirmed)
        val dl = download("completed", completedAt = 5_001L, completedEventSent = true, moveCompleted = true)
        assertFalse(DownloadManagerModule.shouldRemoveDownload(dl, liveStatus = "completed", currentTimeMs = 10_000L))
    }

    @Test
    fun `shouldRemoveDownload uses exactly 5000ms threshold — just expired`() {
        // t=10000, completedAt=4999 → age=5001ms — above threshold (move confirmed)
        val dl = download("completed", completedAt = 4_999L, completedEventSent = true, moveCompleted = true)
        assertTrue(DownloadManagerModule.shouldRemoveDownload(dl, liveStatus = "completed", currentTimeMs = 10_000L))
    }

    @Test
    fun `shouldRemoveDownload never removes without moveCompleted even when very old`() {
        // completedAt far in the past, eventSent=true, but moveCompleted=false — must NOT remove
        val now = System.currentTimeMillis()
        val dl = download("completed", completedAt = now - 300_000L, completedEventSent = true, moveCompleted = false)
        assertFalse(DownloadManagerModule.shouldRemoveDownload(dl, liveStatus = "completed", currentTimeMs = now))
    }

    @Test
    fun `shouldRemoveDownload requires completedAt to be set to remove`() {
        // completedAt=0 even with moveCompleted=true — guard against incomplete records
        val now = System.currentTimeMillis()
        val dl = download("completed", completedAt = 0L, completedEventSent = true, moveCompleted = true)
        assertFalse(DownloadManagerModule.shouldRemoveDownload(dl, liveStatus = "completed", currentTimeMs = now))
    }

    @Test
    fun `shouldRemoveDownload handles multiple downloads independently`() {
        val now = System.currentTimeMillis()
        val movedDl   = download("completed", completedAt = now - 10_000L, completedEventSent = true, moveCompleted = true)
        val unmovedDl = download("completed", completedAt = now - 10_000L, completedEventSent = true, moveCompleted = false)
        val pendingDl = download("pending")

        assertTrue(DownloadManagerModule.shouldRemoveDownload(movedDl, liveStatus = "completed", currentTimeMs = now))
        assertFalse(DownloadManagerModule.shouldRemoveDownload(unmovedDl, liveStatus = "completed", currentTimeMs = now))
        assertFalse(DownloadManagerModule.shouldRemoveDownload(pendingDl, liveStatus = "pending", currentTimeMs = now))
    }

    @Test
    fun `shouldRemoveDownload with unknown liveStatus removes regardless of stored state`() {
        assertTrue(DownloadManagerModule.shouldRemoveDownload(download("running"), liveStatus = "unknown"))
        assertTrue(DownloadManagerModule.shouldRemoveDownload(download("pending"), liveStatus = "unknown"))
        assertTrue(DownloadManagerModule.shouldRemoveDownload(download("paused"), liveStatus = "unknown"))
        assertTrue(DownloadManagerModule.shouldRemoveDownload(download("completed"), liveStatus = "unknown"))
    }

    @Test
    fun `shouldRemoveDownload defaults moveCompleted to false when flag is absent`() {
        // Legacy entries without moveCompleted key should NOT be removed
        val now = System.currentTimeMillis()
        val dl = JSONObject()
            .put("downloadId", 42L)
            .put("status", "completed")
            .put("completedAt", now - 60_000L)
            .put("completedEventSent", true)
        // No moveCompleted key — defaults to false
        assertFalse(DownloadManagerModule.shouldRemoveDownload(dl, liveStatus = "completed", currentTimeMs = now))
    }
}
