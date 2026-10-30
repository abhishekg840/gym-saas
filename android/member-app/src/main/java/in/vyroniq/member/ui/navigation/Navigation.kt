package in.vyroniq.member.ui.navigation

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.QrCode2
import androidx.compose.material.icons.filled.ShoppingBag
import androidx.compose.ui.graphics.vector.ImageVector

sealed class Screen(val route: String, val title: String, val icon: ImageVector) {
    object Pass : Screen("pass", "Entry Pass", Icons.Default.QrCode2)
    object Attendance : Screen("attendance", "Workouts", Icons.Default.CalendarMonth)
    object Membership : Screen("membership", "Plan & Dues", Icons.Default.CreditCard)
    object Store : Screen("store", "Gym Store", Icons.Default.ShoppingBag)
    object Profile : Screen("profile", "Profile", Icons.Default.Person)
}

val bottomNavItems = listOf(
    Screen.Pass,
    Screen.Attendance,
    Screen.Membership,
    Screen.Store,
    Screen.Profile
)

