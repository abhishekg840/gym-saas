package in.vyroniq.owner.ui.navigation

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.PointOfSale
import androidx.compose.material.icons.filled.Router
import androidx.compose.ui.graphics.vector.ImageVector

sealed class OwnerScreen(val route: String, val title: String, val icon: ImageVector) {
    object Dashboard : OwnerScreen("dashboard", "Overview", Icons.Default.Dashboard)
    object Members : OwnerScreen("members", "Directory", Icons.Default.Group)
    object Billing : OwnerScreen("billing", "Collect Fees", Icons.Default.PointOfSale)
    object Hardware : OwnerScreen("hardware", "Hardware & Gate", Icons.Default.Router)
}

val ownerNavItems = listOf(
    OwnerScreen.Dashboard,
    OwnerScreen.Members,
    OwnerScreen.Billing,
    OwnerScreen.Hardware
)

