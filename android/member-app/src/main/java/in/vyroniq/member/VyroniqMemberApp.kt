package `in`.vyroniq.member

import android.app.Application
import `in`.vyroniq.member.data.security.EncryptedSessionManager

class VyroniqMemberApp : Application() {
    lateinit var sessionManager: EncryptedSessionManager
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        sessionManager = EncryptedSessionManager(this)
    }

    companion object {
        lateinit var instance: VyroniqMemberApp
            private set
    }
}

