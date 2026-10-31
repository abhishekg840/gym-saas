package `in`.vyroniq.member.data.security

import `in`.vyroniq.member.BuildConfig
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

object PassTokenGenerator {

    private const val WINDOW_STEP_MS = 30_000L // 30 seconds

    fun getCurrentWindow(): Long = System.currentTimeMillis() / WINDOW_STEP_MS

    fun getRemainingSecondsInWindow(): Int {
        val elapsedInWindow = System.currentTimeMillis() % WINDOW_STEP_MS
        return ((WINDOW_STEP_MS - elapsedInWindow) / 1000L).toInt()
    }

    fun generateSignedPayload(memberId: String, tenantId: String, window: Long = getCurrentWindow()): String {
        val secret = BuildConfig.AUTH_SECRET
        val dataToSign = "$memberId:$tenantId:$window"
        val signature = hmacSha256(dataToSign, secret)
        val timestamp = System.currentTimeMillis()

        return "vyroniq://pass?m=$memberId&t=$tenantId&w=$window&sig=$signature&ts=$timestamp"
    }

    private fun hmacSha256(data: String, secret: String): String {
        return try {
            val sha256Hmac = Mac.getInstance("HmacSHA256")
            val secretKey = SecretKeySpec(secret.toByteArray(StandardCharsets.UTF_8), "HmacSHA256")
            sha256Hmac.init(secretKey)
            val signedBytes = sha256Hmac.doFinal(data.toByteArray(StandardCharsets.UTF_8))
            bytesToHex(signedBytes)
        } catch (e: Exception) {
            // Fallback digest if Mac fails
            val md = MessageDigest.getInstance("SHA-256")
            bytesToHex(md.digest((data + secret).toByteArray(StandardCharsets.UTF_8)))
        }
    }

    private fun bytesToHex(bytes: ByteArray): String {
        val hexChars = "0123456789abcdef"
        val result = StringBuilder(bytes.size * 2)
        for (b in bytes) {
            val i = b.toInt() and 0xff
            result.append(hexChars[i shr 4])
            result.append(hexChars[i and 0x0f])
        }
        return result.toString()
    }
}

