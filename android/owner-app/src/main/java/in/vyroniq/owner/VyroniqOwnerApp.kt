package in.vyroniq.owner

import android.app.Application
import in.vyroniq.owner.data.security.OwnerSessionManager

class VyroniqOwnerApp : Application() {
    lateinit var sessionManager: OwnerSessionManager
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        sessionManager = OwnerSessionManager(this)
    }

    companion object {
        lateinit var instance: VyroniqOwnerApp
            private set
    }
}

