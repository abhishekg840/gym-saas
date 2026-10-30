package in.vyroniq.owner

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.fragment.app.FragmentActivity
import in.vyroniq.owner.ui.navigation.OwnerScreen
import in.vyroniq.owner.ui.navigation.ownerNavItems
import in.vyroniq.owner.ui.screens.BillingHubScreen
import in.vyroniq.owner.ui.screens.ExecutiveDashboardScreen
import in.vyroniq.owner.ui.screens.HardwareTerminalScreen
import in.vyroniq.owner.ui.screens.MemberDirectoryScreen
import in.vyroniq.owner.ui.screens.OwnerLoginScreen
import in.vyroniq.owner.ui.theme.Emerald400
import in.vyroniq.owner.ui.theme.Emerald600
import in.vyroniq.owner.ui.theme.Slate400
import in.vyroniq.owner.ui.theme.Slate900
import in.vyroniq.owner.ui.theme.Slate950
import in.vyroniq.owner.ui.theme.VyroniqOwnerTheme

class MainActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            VyroniqOwnerTheme {
                OwnerAppEntry()
            }
        }
    }
}

@Composable
fun OwnerAppEntry() {
    val sessionManager = VyroniqOwnerApp.instance.sessionManager
    var isLoggedIn by remember { mutableStateOf(sessionManager.isLoggedIn()) }
    var currentScreen by remember { mutableStateOf<OwnerScreen>(OwnerScreen.Dashboard) }

    if (!isLoggedIn) {
        OwnerLoginScreen(
            onLoginSuccess = { isLoggedIn = true }
        )
    } else {
        Scaffold(
            bottomBar = {
                NavigationBar(
                    containerColor = Slate900,
                    tonalElevation = 8.dp
                ) {
                    ownerNavItems.forEach { screen ->
                        val selected = currentScreen.route == screen.route
                        NavigationBarItem(
                            selected = selected,
                            onClick = { currentScreen = screen },
                            icon = {
                                Icon(
                                    imageVector = screen.icon,
                                    contentDescription = screen.title
                                )
                            },
                            label = {
                                Text(
                                    text = screen.title,
                                    fontSize = 11.sp
                                )
                            },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = Color.White,
                                selectedTextColor = Emerald400,
                                indicatorColor = Emerald600,
                                unselectedIconColor = Slate400,
                                unselectedTextColor = Slate400
                            )
                        )
                    }
                }
            }
        ) { innerPadding ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Slate950)
                    .padding(innerPadding)
            ) {
                when (currentScreen) {
                    OwnerScreen.Dashboard -> ExecutiveDashboardScreen(
                        onNavigateToBilling = { currentScreen = OwnerScreen.Billing },
                        onNavigateToMembers = { currentScreen = OwnerScreen.Members }
                    )
                    OwnerScreen.Members -> MemberDirectoryScreen()
                    OwnerScreen.Billing -> BillingHubScreen()
                    OwnerScreen.Hardware -> HardwareTerminalScreen()
                }
            }
        }
    }
}

