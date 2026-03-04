package ai.offgridmobile.localdream

import android.app.Application
import android.graphics.BitmapFactory
import android.os.Build
import android.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.util.ReflectionHelpers
import java.io.File

/**
 * Tests for pure helper functions in LocalDreamModule.
 * All methods under test live in the companion object and have no instance state.
 */
@Suppress("kotlin:S100") // Backtick test names are idiomatic Kotlin
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = Application::class)
class LocalDreamModuleTest {

    @get:Rule
    val tmp = TemporaryFolder()

    // ── isNpuSupportedInternal ────────────────────────────────────────────────

    @Test
    fun `isNpuSupportedInternal returns true for SM8650 (SD 8 Gen 3)`() {
        ReflectionHelpers.setStaticField(Build::class.java, "SOC_MODEL", "SM8650")
        assertTrue(LocalDreamModule.isNpuSupportedInternal())
    }

    @Test
    fun `isNpuSupportedInternal returns true for SM8550 (SD 8 Gen 2)`() {
        ReflectionHelpers.setStaticField(Build::class.java, "SOC_MODEL", "SM8550")
        assertTrue(LocalDreamModule.isNpuSupportedInternal())
    }

    @Test
    fun `isNpuSupportedInternal returns true for SM8350 (SD 888)`() {
        ReflectionHelpers.setStaticField(Build::class.java, "SOC_MODEL", "SM8350")
        assertTrue(LocalDreamModule.isNpuSupportedInternal())
    }

    @Test
    fun `isNpuSupportedInternal returns true for SM8635 (SD 8s Gen 3)`() {
        ReflectionHelpers.setStaticField(Build::class.java, "SOC_MODEL", "SM8635")
        assertTrue(LocalDreamModule.isNpuSupportedInternal())
    }

    @Test
    fun `isNpuSupportedInternal returns true for SM7450 (SD 7 Gen 1)`() {
        ReflectionHelpers.setStaticField(Build::class.java, "SOC_MODEL", "SM7450")
        assertTrue(LocalDreamModule.isNpuSupportedInternal())
    }

    @Test
    fun `isNpuSupportedInternal returns true for SM8250 (SD 870 — any SM is supported)`() {
        ReflectionHelpers.setStaticField(Build::class.java, "SOC_MODEL", "SM8250")
        assertTrue(LocalDreamModule.isNpuSupportedInternal())
    }

    @Test
    fun `isNpuSupportedInternal returns true for SM7225 (SD 750G — any SM is supported)`() {
        ReflectionHelpers.setStaticField(Build::class.java, "SOC_MODEL", "SM7225")
        assertTrue(LocalDreamModule.isNpuSupportedInternal())
    }

    @Test
    fun `isNpuSupportedInternal returns false for QCS prefix (not SM)`() {
        ReflectionHelpers.setStaticField(Build::class.java, "SOC_MODEL", "QCS8550")
        assertFalse(LocalDreamModule.isNpuSupportedInternal())
    }

    @Test
    fun `isNpuSupportedInternal returns false for QCM prefix (not SM)`() {
        ReflectionHelpers.setStaticField(Build::class.java, "SOC_MODEL", "QCM6490")
        assertFalse(LocalDreamModule.isNpuSupportedInternal())
    }

    @Test
    fun `isNpuSupportedInternal returns false for non-Qualcomm SoC`() {
        ReflectionHelpers.setStaticField(Build::class.java, "SOC_MODEL", "Exynos2400")
        assertFalse(LocalDreamModule.isNpuSupportedInternal())
    }

    @Test
    fun `isNpuSupportedInternal returns false for Tensor (Google)`() {
        ReflectionHelpers.setStaticField(Build::class.java, "SOC_MODEL", "Tensor G4")
        assertFalse(LocalDreamModule.isNpuSupportedInternal())
    }

    @Test
    fun `isNpuSupportedInternal returns false for empty SoC model`() {
        ReflectionHelpers.setStaticField(Build::class.java, "SOC_MODEL", "")
        assertFalse(LocalDreamModule.isNpuSupportedInternal())
    }

    // ── resolveModelDir ───────────────────────────────────────────────────────

    @Test
    fun `resolveModelDir returns root dir when marker is at root for CPU`() {
        val root = tmp.newFolder("model")
        root.resolve("unet.mnn").createNewFile()

        assertEquals(root, LocalDreamModule.resolveModelDir(root, isCpu = true))
    }

    @Test
    fun `resolveModelDir returns root dir when marker is at root for QNN`() {
        val root = tmp.newFolder("model")
        root.resolve("unet.bin").createNewFile()

        assertEquals(root, LocalDreamModule.resolveModelDir(root, isCpu = false))
    }

    @Test
    fun `resolveModelDir finds marker one level deep`() {
        val root = tmp.newFolder("model")
        val sub = root.resolve("inner").also { it.mkdir() }
        sub.resolve("unet.mnn").createNewFile()

        assertEquals(sub, LocalDreamModule.resolveModelDir(root, isCpu = true))
    }

    @Test
    fun `resolveModelDir finds marker three levels deep`() {
        val root = tmp.newFolder("model")
        val deep = root.resolve("a/b/c").also { it.mkdirs() }
        deep.resolve("unet.bin").createNewFile()

        assertEquals(deep, LocalDreamModule.resolveModelDir(root, isCpu = false))
    }

    @Test
    fun `resolveModelDir finds marker four levels deep (boundary of search depth)`() {
        // searchDir is called with depth=3 for the 4th level directory — depth > 3 is false,
        // so children are still checked. The limit only cuts off at depth=4 (5 levels below root).
        val root = tmp.newFolder("model")
        val deep = root.resolve("a/b/c/d").also { it.mkdirs() }
        deep.resolve("unet.mnn").createNewFile()

        assertEquals(deep, LocalDreamModule.resolveModelDir(root, isCpu = true))
    }

    @Test
    fun `resolveModelDir returns null when marker is five levels deep (beyond limit)`() {
        val root = tmp.newFolder("model")
        root.resolve("a/b/c/d/e").also { it.mkdirs() }.resolve("unet.mnn").createNewFile()

        assertNull(LocalDreamModule.resolveModelDir(root, isCpu = true))
    }

    @Test
    fun `resolveModelDir returns null when no marker file exists`() {
        val root = tmp.newFolder("model")
        root.resolve("some_other_file.bin").createNewFile()

        assertNull(LocalDreamModule.resolveModelDir(root, isCpu = true))
    }

    @Test
    fun `resolveModelDir does not confuse CPU and QNN markers`() {
        val root = tmp.newFolder("model")
        root.resolve("unet.bin").createNewFile() // QNN marker only

        // CPU search should not match unet.bin
        assertNull(LocalDreamModule.resolveModelDir(root, isCpu = true))
        // QNN search should match
        assertNotNull(LocalDreamModule.resolveModelDir(root, isCpu = false))
    }

    // ── buildCommand — CPU (MNN) backend ─────────────────────────────────────

    private fun makeCpuModelDir(): java.io.File = tmp.newFolder("cpu_model").also { dir ->
        dir.resolve("clip.mnn").createNewFile()
        dir.resolve("unet.mnn").createNewFile()
        dir.resolve("vae_decoder.mnn").createNewFile()
        dir.resolve("tokenizer.json").createNewFile()
    }

    private fun makeQnnModelDir(withMnnClip: Boolean = false): java.io.File =
        tmp.newFolder("qnn_model").also { dir ->
            if (withMnnClip) dir.resolve("clip.mnn").createNewFile()
            dir.resolve("unet.bin").createNewFile()
            dir.resolve("vae_decoder.bin").createNewFile()
            dir.resolve("tokenizer.json").createNewFile()
        }

    private fun makeExecutable(): java.io.File = tmp.newFile("libstable_diffusion_core.so")
    private fun makeRuntimeDir(): java.io.File = tmp.newFolder("runtime")

    @Test
    fun `buildCommand CPU includes --cpu flag`() {
        val cmd = LocalDreamModule.buildCommand(
            makeExecutable(), makeCpuModelDir(), makeRuntimeDir(), isCpu = true,
        )
        assertTrue(cmd.contains("--cpu"))
    }

    @Test
    fun `buildCommand CPU uses clip mnn path`() {
        val modelDir = makeCpuModelDir()
        val cmd = LocalDreamModule.buildCommand(makeExecutable(), modelDir, makeRuntimeDir(), isCpu = true)

        val clipIdx = cmd.indexOf("--clip")
        assertTrue("--clip flag missing", clipIdx >= 0)
        assertTrue("clip path should end with clip.mnn", cmd[clipIdx + 1].endsWith("clip.mnn"))
    }

    @Test
    fun `buildCommand CPU sets correct port`() {
        val cmd = LocalDreamModule.buildCommand(
            makeExecutable(), makeCpuModelDir(), makeRuntimeDir(), isCpu = true,
        )
        val portIdx = cmd.indexOf("--port")
        assertTrue(portIdx >= 0)
        assertEquals("18081", cmd[portIdx + 1])
    }

    @Test
    fun `buildCommand CPU includes vae_encoder when present`() {
        val modelDir = makeCpuModelDir()
        modelDir.resolve("vae_encoder.mnn").createNewFile()

        val cmd = LocalDreamModule.buildCommand(makeExecutable(), modelDir, makeRuntimeDir(), isCpu = true)

        val encoderIdx = cmd.indexOf("--vae_encoder")
        assertTrue("--vae_encoder flag missing", encoderIdx >= 0)
        assertTrue(cmd[encoderIdx + 1].endsWith("vae_encoder.mnn"))
    }

    @Test
    fun `buildCommand CPU omits vae_encoder when absent`() {
        val cmd = LocalDreamModule.buildCommand(
            makeExecutable(), makeCpuModelDir(), makeRuntimeDir(), isCpu = true,
        )
        assertFalse(cmd.contains("--vae_encoder"))
    }

    // ── buildCommand — QNN (NPU) backend ─────────────────────────────────────

    @Test
    fun `buildCommand QNN does not include --cpu flag`() {
        val cmd = LocalDreamModule.buildCommand(
            makeExecutable(), makeQnnModelDir(), makeRuntimeDir(), isCpu = false,
        )
        assertFalse(cmd.contains("--cpu"))
    }

    @Test
    fun `buildCommand QNN uses clip bin when no mnn clip present`() {
        val modelDir = makeQnnModelDir(withMnnClip = false)
        val cmd = LocalDreamModule.buildCommand(makeExecutable(), modelDir, makeRuntimeDir(), isCpu = false)

        val clipIdx = cmd.indexOf("--clip")
        assertTrue(clipIdx >= 0)
        assertTrue("should use clip.bin", cmd[clipIdx + 1].endsWith("clip.bin"))
        assertFalse("should not add --use_cpu_clip", cmd.contains("--use_cpu_clip"))
    }

    @Test
    fun `buildCommand QNN uses clip mnn and adds use_cpu_clip when mnn clip present`() {
        val modelDir = makeQnnModelDir(withMnnClip = true)
        val cmd = LocalDreamModule.buildCommand(makeExecutable(), modelDir, makeRuntimeDir(), isCpu = false)

        val clipIdx = cmd.indexOf("--clip")
        assertTrue(clipIdx >= 0)
        assertTrue("should use clip.mnn", cmd[clipIdx + 1].endsWith("clip.mnn"))
        assertTrue("should add --use_cpu_clip", cmd.contains("--use_cpu_clip"))
    }

    @Test
    fun `buildCommand QNN uses clip mnn when only clip_v2 mnn present`() {
        val modelDir = makeQnnModelDir(withMnnClip = false).also {
            it.resolve("clip_v2.mnn").createNewFile()
        }
        val cmd = LocalDreamModule.buildCommand(makeExecutable(), modelDir, makeRuntimeDir(), isCpu = false)

        assertTrue("should add --use_cpu_clip for clip_v2", cmd.contains("--use_cpu_clip"))
    }

    @Test
    fun `buildCommand QNN includes vae_encoder bin when present`() {
        val modelDir = makeQnnModelDir().also {
            it.resolve("vae_encoder.bin").createNewFile()
        }
        val cmd = LocalDreamModule.buildCommand(makeExecutable(), modelDir, makeRuntimeDir(), isCpu = false)

        val encoderIdx = cmd.indexOf("--vae_encoder")
        assertTrue(encoderIdx >= 0)
        assertTrue(cmd[encoderIdx + 1].endsWith("vae_encoder.bin"))
    }

    @Test
    fun `buildCommand QNN includes backend and system_library paths`() {
        val runtimeDir = makeRuntimeDir()
        val cmd = LocalDreamModule.buildCommand(
            makeExecutable(), makeQnnModelDir(), runtimeDir, isCpu = false,
        )

        val backendIdx = cmd.indexOf("--backend")
        assertTrue(backendIdx >= 0)
        assertTrue(cmd[backendIdx + 1].endsWith("libQnnHtp.so"))

        val sysLibIdx = cmd.indexOf("--system_library")
        assertTrue(sysLibIdx >= 0)
        assertTrue(cmd[sysLibIdx + 1].endsWith("libQnnSystem.so"))
    }

    // ── buildEnvironment ──────────────────────────────────────────────────────

    @Test
    fun `buildEnvironment always sets all three env vars`() {
        val runtimeDir = makeRuntimeDir()
        val env = LocalDreamModule.buildEnvironment(runtimeDir)

        assertTrue(env.containsKey("LD_LIBRARY_PATH"))
        assertTrue(env.containsKey("DSP_LIBRARY_PATH"))
        assertTrue(env.containsKey("ADSP_LIBRARY_PATH"))
    }

    @Test
    fun `buildEnvironment sets DSP and ADSP paths to runtimeDir`() {
        val runtimeDir = makeRuntimeDir()
        val env = LocalDreamModule.buildEnvironment(runtimeDir)

        assertEquals(runtimeDir.absolutePath, env["DSP_LIBRARY_PATH"])
        assertEquals(runtimeDir.absolutePath, env["ADSP_LIBRARY_PATH"])
    }

    @Test
    fun `buildEnvironment includes runtimeDir as first entry in LD_LIBRARY_PATH`() {
        val runtimeDir = makeRuntimeDir()
        val env = LocalDreamModule.buildEnvironment(runtimeDir)

        val paths = requireNotNull(env["LD_LIBRARY_PATH"]).split(":")
        assertEquals(runtimeDir.absolutePath, paths.first())
    }

    @Test
    fun `buildEnvironment includes standard system library paths`() {
        val env = LocalDreamModule.buildEnvironment(makeRuntimeDir())
        val ldPath = requireNotNull(env["LD_LIBRARY_PATH"])

        assertTrue(ldPath.contains("/system/lib64"))
        assertTrue(ldPath.contains("/vendor/lib64"))
        assertTrue(ldPath.contains("/vendor/lib64/egl"))
    }

    // ── saveRgbToPng ──────────────────────────────────────────────────────────

    private fun rgbBase64(vararg bytes: Int): String =
        Base64.encodeToString(ByteArray(bytes.size) { bytes[it].toByte() }, Base64.DEFAULT)

    @Test
    fun `saveRgbToPng throws when byte count does not match dimensions`() {
        val base64 = Base64.encodeToString(ByteArray(6), Base64.DEFAULT) // 6 bytes but 2x2 needs 12
        try {
            LocalDreamModule.saveRgbToPng(base64, 2, 2, tmp.newFile("out.png").absolutePath)
            fail("Expected IllegalArgumentException")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("doesn't match expected"))
            assertTrue(e.message!!.contains("12"))
        }
    }

    @Test
    fun `saveRgbToPng creates a PNG file at the given path`() {
        val base64 = rgbBase64(0xFF, 0x00, 0x00) // 1x1 red
        val out = tmp.newFile("out.png")
        LocalDreamModule.saveRgbToPng(base64, 1, 1, out.absolutePath)
        assertTrue(out.exists())
        assertTrue("file should not be empty", out.length() > 0)
    }

    @Test
    fun `saveRgbToPng creates parent directories when they do not exist`() {
        val out = File(tmp.root, "a/b/c/out.png")
        assertFalse(out.parentFile!!.exists())
        LocalDreamModule.saveRgbToPng(rgbBase64(0, 0, 0), 1, 1, out.absolutePath)
        assertTrue(out.exists())
    }

    @Test
    fun `saveRgbToPng encodes red channel correctly`() {
        // 1x1 pure red: R=255, G=0, B=0  →  ARGB = 0xFFFF0000
        val base64 = rgbBase64(0xFF, 0x00, 0x00)
        val out = tmp.newFile("red.png")
        LocalDreamModule.saveRgbToPng(base64, 1, 1, out.absolutePath)
        val pixel = BitmapFactory.decodeFile(out.absolutePath).getPixel(0, 0)
        assertEquals(0xFFFF0000.toInt(), pixel)
    }

    @Test
    fun `saveRgbToPng encodes blue channel correctly`() {
        // 1x1 pure blue: R=0, G=0, B=255  →  ARGB = 0xFF0000FF
        val base64 = rgbBase64(0x00, 0x00, 0xFF)
        val out = tmp.newFile("blue.png")
        LocalDreamModule.saveRgbToPng(base64, 1, 1, out.absolutePath)
        val pixel = BitmapFactory.decodeFile(out.absolutePath).getPixel(0, 0)
        assertEquals(0xFF0000FF.toInt(), pixel)
    }

    @Test
    fun `saveRgbToPng encodes all pixels for a multi-pixel image`() {
        // 2x1 image: [red | blue]
        val base64 = rgbBase64(0xFF, 0x00, 0x00,  0x00, 0x00, 0xFF)
        val out = tmp.newFile("2x1.png")
        LocalDreamModule.saveRgbToPng(base64, 2, 1, out.absolutePath)
        val bmp = BitmapFactory.decodeFile(out.absolutePath)
        assertEquals(0xFFFF0000.toInt(), bmp.getPixel(0, 0))
        assertEquals(0xFF0000FF.toInt(), bmp.getPixel(1, 0))
    }

    @Test
    fun `saveRgbToPng preserves alpha as fully opaque`() {
        // Any RGB pixel should decode to alpha=0xFF
        val base64 = rgbBase64(0x12, 0x34, 0x56)
        val out = tmp.newFile("alpha.png")
        LocalDreamModule.saveRgbToPng(base64, 1, 1, out.absolutePath)
        val pixel = BitmapFactory.decodeFile(out.absolutePath).getPixel(0, 0)
        val alpha = (pixel ushr 24) and 0xFF
        assertEquals(0xFF, alpha)
    }
}
