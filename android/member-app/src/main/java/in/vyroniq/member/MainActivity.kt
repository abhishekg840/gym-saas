package `in`.vyroniq.member

import android.os.Bundle
import androidx.activity.ComponentActivity
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
import `in`.vyroniq.member.ui.navigation.Screen
import `in`.vyroniq.member.ui.navigation.bottomNavItems
import `in`.vyroniq.member.ui.screens.AttendanceScreen
import `in`.vyroniq.member.ui.screens.LoginScreen
import `in`.vyroniq.member.ui.screens.MembershipScreen
import `in`.vyroniq.member.ui.screens.PassScreen
import `in`.vyroniq.member.ui.screens.ProfileScreen
import `in`.vyroniq.member.ui.screens.StoreScreen
import `in`.vyroniq.member.ui.theme.Emerald400
import `in`.vyroniq.member.ui.theme.Emerald600
import `in`.vyroniq.member.ui.theme.Slate400
import `in`.vyroniq.member.ui.theme.Slate900
import `in`.vyroniq.member.ui.theme.Slate950
import `in`.vyroniq.member.ui.theme.VyroniqTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            VyroniqTheme {
                MainAppEntry()
            }
        }
    }
}

@Composable
fun MainAppEntry() {
    val sessionManager = VyroniqMemberApp.instance.sessionManager
    var isLoggedIn by remember { mutableStateOf(sessionManager.isLoggedIn()) }
    var currentScreen by remember { mutableStateOf<Screen>(Screen.Pass) }

    if (!isLoggedIn) {
        LoginScreen(
            onLoginSuccess = { isLoggedIn = true }
        )
    } else {
        Scaffold(
            bottomBar = {
                NavigationBar(
                    containerColor = Slate900,
                    tonalElevation = 8.dp
                ) {
                    bottomNavItems.forEach { screen ->
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
                    Screen.Pass -> PassScreen()
                    Screen.Attendance -> AttendanceScreen()
                    Screen.Membership -> MembershipScreen()
                    Screen.Store -> StoreScreen()
                    Screen.Profile -> ProfileScreen(onLogout = { isLoggedIn = false })
                }
            }
        }
    }
}

