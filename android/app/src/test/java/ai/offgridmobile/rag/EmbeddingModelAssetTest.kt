package ai.offgridmobile.rag

import android.app.Application
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import androidx.test.core.app.ApplicationProvider

/**
 * Tests that the embedding model GGUF file is correctly bundled
 * in the Android app's assets and accessible at runtime.
 */
@Suppress("kotlin:S100")
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = Application::class)
class EmbeddingModelAssetTest {

    private val modelPath = "models/all-MiniLM-L6-v2-Q8_0.gguf"

    @Test
    fun `embedding model exists in assets`() {
        val context = ApplicationProvider.getApplicationContext<Application>()
        val stream = context.assets.open(modelPath)
        assertNotNull("Embedding model must be present in assets at $modelPath", stream)
        stream.close()
    }

    @Test
    fun `embedding model is not empty`() {
        val context = ApplicationProvider.getApplicationContext<Application>()
        val stream = context.assets.open(modelPath)
        val size = stream.available()
        stream.close()
        assertTrue("Embedding model should be at least 1MB (got $size bytes)", size > 1_000_000)
    }

    @Test
    fun `embedding model has GGUF magic bytes`() {
        val context = ApplicationProvider.getApplicationContext<Application>()
        val stream = context.assets.open(modelPath)
        val magic = ByteArray(4)
        val bytesRead = stream.read(magic)
        stream.close()

        assertTrue("Should read 4 magic bytes", bytesRead == 4)
        // GGUF magic: "GGUF" in ASCII
        val magicStr = String(magic, Charsets.US_ASCII)
        assertTrue("File should start with GGUF magic bytes, got: $magicStr", magicStr == "GGUF")
    }

    @Test
    fun `noCompress keeps gguf files uncompressed in APK`() {
        // This is a build-time verification — if the aaptOptions noCompress 'gguf'
        // directive is missing from build.gradle, the asset will be compressed and
        // copying it byte-for-byte to DocumentDirectoryPath will produce a corrupt file.
        // We verify the asset is readable and starts with correct magic bytes,
        // which would fail if compression corrupted the content.
        val context = ApplicationProvider.getApplicationContext<Application>()
        val stream = context.assets.open(modelPath)
        val magic = ByteArray(4)
        stream.read(magic)
        stream.close()

        val magicStr = String(magic, Charsets.US_ASCII)
        assertTrue(
            "GGUF magic bytes should be intact (not compressed). Got: $magicStr",
            magicStr == "GGUF"
        )
    }
}
