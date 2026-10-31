package `in`.vyroniq.member.data.security

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.google.gson.Gson
import `in`.vyroniq.member.data.model.MemberProfile

class EncryptedSessionManager(context: Context) {

    private val prefs: SharedPreferences
    private val gson = Gson()

    init {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        prefs = EncryptedSharedPreferences.create(
            context,
            PREF_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    fun saveSession(token: String, profile: MemberProfile) {
        prefs.edit()
            .putString(KEY_AUTH_TOKEN, token)
            .putString(KEY_MEMBER_ID, profile.id)
            .putString(KEY_TENANT_ID, profile.tenantId)
            .putString(KEY_PHONE, profile.phone)
            .putString(KEY_PROFILE_JSON, gson.toJson(profile))
            .putBoolean(KEY_IS_LOGGED_IN, true)
            .apply()
    }

    fun updateProfile(profile: MemberProfile) {
        prefs.edit()
            .putString(KEY_PROFILE_JSON, gson.toJson(profile))
            .apply()
    }

    fun getProfile(): MemberProfile? {
        val json = prefs.getString(KEY_PROFILE_JSON, null) ?: return null
        return try {
            gson.fromJson(json, MemberProfile::class.java)
        } catch (e: Exception) {
            null
        }
    }

    fun getAuthToken(): String? = prefs.getString(KEY_AUTH_TOKEN, null)
    fun getMemberId(): String? = prefs.getString(KEY_MEMBER_ID, null)
    fun getTenantId(): String? = prefs.getString(KEY_TENANT_ID, null)
    fun getPhone(): String? = prefs.getString(KEY_PHONE, null)

    fun isLoggedIn(): Boolean = prefs.getBoolean(KEY_IS_LOGGED_IN, false) && !getMemberId().isNullOrBlank()

    fun cacheOfflinePassToken(token: String) {
        prefs.edit()
            .putString(KEY_OFFLINE_PASS, token)
            .putLong(KEY_OFFLINE_PASS_TIME, System.currentTimeMillis())
            .apply()
    }

    fun getOfflinePassToken(): String? = prefs.getString(KEY_OFFLINE_PASS, null)

    fun clearSession() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val PREF_NAME = "vyroniq_member_secure_prefs"
        private const val KEY_AUTH_TOKEN = "auth_token"
        private const val KEY_MEMBER_ID = "member_id"
        private const val KEY_TENANT_ID = "tenant_id"
        private const val KEY_PHONE = "phone"
        private const val KEY_PROFILE_JSON = "profile_json"
        private const val KEY_IS_LOGGED_IN = "is_logged_in"
        private const val KEY_OFFLINE_PASS = "offline_pass_token"
        private const val KEY_OFFLINE_PASS_TIME = "offline_pass_time"
    }
}

