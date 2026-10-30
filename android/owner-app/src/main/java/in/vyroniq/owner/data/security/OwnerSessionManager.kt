package in.vyroniq.owner.data.security

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.google.gson.Gson
import in.vyroniq.owner.data.model.Tenant

class OwnerSessionManager(context: Context) {

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

    fun saveTenantSession(tenant: Tenant, authPin: String) {
        prefs.edit()
            .putString(KEY_TENANT_ID, tenant.id)
            .putString(KEY_TENANT_NAME, tenant.name)
            .putString(KEY_TENANT_SLUG, tenant.subdomainSlug ?: "")
            .putString(KEY_TENANT_JSON, gson.toJson(tenant))
            .putString(KEY_AUTH_PIN, authPin)
            .putBoolean(KEY_IS_LOGGED_IN, true)
            .putBoolean(KEY_BIOMETRICS_ENABLED, true)
            .apply()
    }

    fun getTenant(): Tenant? {
        val json = prefs.getString(KEY_TENANT_JSON, null) ?: return null
        return try {
            gson.fromJson(json, Tenant::class.java)
        } catch (e: Exception) {
            null
        }
    }

    fun getTenantId(): String = prefs.getString(KEY_TENANT_ID, "") ?: ""
    fun getTenantName(): String = prefs.getString(KEY_TENANT_NAME, "Vyroniq Gym") ?: "Vyroniq Gym"
    fun getAuthPin(): String? = prefs.getString(KEY_AUTH_PIN, null)

    fun isLoggedIn(): Boolean = prefs.getBoolean(KEY_IS_LOGGED_IN, false) && getTenantId().isNotBlank()
    fun isBiometricsEnabled(): Boolean = prefs.getBoolean(KEY_BIOMETRICS_ENABLED, false)

    fun clearSession() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val PREF_NAME = "vyroniq_owner_secure_prefs"
        private const val KEY_TENANT_ID = "tenant_id"
        private const val KEY_TENANT_NAME = "tenant_name"
        private const val KEY_TENANT_SLUG = "tenant_slug"
        private const val KEY_TENANT_JSON = "tenant_json"
        private const val KEY_AUTH_PIN = "auth_pin"
        private const val KEY_IS_LOGGED_IN = "is_logged_in"
        private const val KEY_BIOMETRICS_ENABLED = "biometrics_enabled"
    }
}

