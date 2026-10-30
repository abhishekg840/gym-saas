package in.vyroniq.member.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Badge
import androidx.compose.material.icons.filled.ExitToApp
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import in.vyroniq.member.VyroniqMemberApp
import in.vyroniq.member.ui.theme.Emerald400
import in.vyroniq.member.ui.theme.Emerald600
import in.vyroniq.member.ui.theme.Rose500
import in.vyroniq.member.ui.theme.Slate400
import in.vyroniq.member.ui.theme.Slate700
import in.vyroniq.member.ui.theme.Slate800
import in.vyroniq.member.ui.theme.Slate900
import in.vyroniq.member.ui.theme.Slate950

@Composable
fun ProfileScreen(onLogout: () -> Unit) {
    val sessionManager = VyroniqMemberApp.instance.sessionManager
    val profile = sessionManager.getProfile()
    var showLogoutDialog by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Slate950)
            .padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = "MEMBER PROFILE",
            color = Emerald400,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.5.sp,
            modifier = Modifier.align(Alignment.Start)
        )
        Text(
            text = "Account & Credentials",
            color = Color.White,
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.align(Alignment.Start)
        )

        Spacer(modifier = Modifier.height(24.dp))

        // Avatar
        Box(
            modifier = Modifier
                .size(80.dp)
                .clip(CircleShape)
                .background(Emerald600),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = (profile?.fullName?.take(1) ?: "U").uppercase(),
                color = Color.White,
                fontSize = 32.sp,
                fontWeight = FontWeight.Bold
            )
        }

        Spacer(modifier = Modifier.height(12.dp))

        Text(
            text = profile?.fullName ?: "Member",
            color = Color.White,
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold
        )

        Text(
            text = profile?.phone ?: "+91 —",
            color = Slate400,
            fontSize = 14.sp
        )

        Spacer(modifier = Modifier.height(28.dp))

        // Hardware Credentials Card
        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = Slate900),
            border = androidx.compose.foundation.BorderStroke(1.dp, Slate800),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "Hardware & Gate Access Keys",
                    color = Color.White,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold
                )

                Spacer(modifier = Modifier.height(14.dp))

                CredentialRow(icon = Icons.Default.Badge, title = "Member Pass ID", value = profile?.id?.take(12) ?: "—")
                Spacer(modifier = Modifier.height(10.dp))
                CredentialRow(icon = Icons.Default.Fingerprint, title = "Biometric Sync", value = "Enrolled (R307 Sensor)")
                Spacer(modifier = Modifier.height(10.dp))
                CredentialRow(icon = Icons.Default.Shield, title = "Tenant Key", value = profile?.tenantId?.take(8) ?: "—")
            }
        }

        Spacer(modifier = Modifier.weight(1f))

        // Explicit Logout Button
        Button(
            onClick = { showLogoutDialog = true },
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Slate900),
            border = androidx.compose.foundation.BorderStroke(1.dp, Rose500.copy(alpha = 0.5f)),
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp)
        ) {
            Icon(Icons.Default.ExitToApp, contentDescription = null, tint = Rose500, modifier = Modifier.size(18.dp))
            Spacer(modifier = Modifier.width(8.dp))
            Text("Sign Out of this Phone", color = Rose500, fontWeight = FontWeight.SemiBold)
        }

        if (showLogoutDialog) {
            AlertDialog(
                onDismissRequest = { showLogoutDialog = false },
                title = { Text("Sign Out?", color = Color.White) },
                text = { Text("You will need to re-verify your phone number to generate entry passes.", color = Slate400) },
                confirmButton = {
                    Button(
                        onClick = {
                            showLogoutDialog = false
                            sessionManager.clearSession()
                            onLogout()
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Rose500)
                    ) {
                        Text("Log Out")
                    }
                },
                dismissButton = {
                    OutlinedButton(onClick = { showLogoutDialog = false }) {
                        Text("Cancel", color = Color.White)
                    }
                },
                containerColor = Slate900
            )
        }
    }
}

@Composable
fun CredentialRow(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null, tint = Emerald400, modifier = Modifier.size(16.dp))
            Spacer(modifier = Modifier.width(8.dp))
            Text(title, color = Slate400, fontSize = 13.sp)
        }
        Text(value, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Medium)
    }
}

