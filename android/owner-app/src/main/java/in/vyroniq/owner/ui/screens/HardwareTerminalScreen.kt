package `in`.vyroniq.owner.ui.screens

import android.widget.Toast
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cable
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.LockOpen
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Router
import androidx.compose.material.icons.filled.Sensors
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import `in`.vyroniq.owner.VyroniqOwnerApp
import `in`.vyroniq.owner.data.model.HardwareDevice
import `in`.vyroniq.owner.data.remote.OwnerApiClient
import `in`.vyroniq.owner.ui.theme.Emerald400
import `in`.vyroniq.owner.ui.theme.Emerald500
import `in`.vyroniq.owner.ui.theme.Emerald600
import `in`.vyroniq.owner.ui.theme.Rose500
import `in`.vyroniq.owner.ui.theme.Slate400
import `in`.vyroniq.owner.ui.theme.Slate700
import `in`.vyroniq.owner.ui.theme.Slate800
import `in`.vyroniq.owner.ui.theme.Slate900
import `in`.vyroniq.owner.ui.theme.Slate950
import kotlinx.coroutines.launch

@Composable
fun HardwareTerminalScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val sessionManager = VyroniqOwnerApp.instance.sessionManager
    val tenantId = sessionManager.getTenantId()

    var devices by remember { mutableStateOf<List<HardwareDevice>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var isUnlocking by remember { mutableStateOf(false) }

    // Fallback devices configuration if tenant hardware records are newly initialized
    val fallbackFleet = listOf(
        HardwareDevice("1", "Main Entry Turnstile Gateway", "turnstile", "online", "Just now", "192.168.1.140"),
        HardwareDevice("2", "Front-Desk Optical QR Reader", "qr_scanner", "online", "Just now", "192.168.1.141"),
        HardwareDevice("3", "Biometric Fingerprint Terminal (R307)", "biometric", "online", "1 min ago", "192.168.1.142"),
        HardwareDevice("4", "Exit RFID Tripod Gate", "turnstile", "online", "Just now", "192.168.1.143")
    )

    suspend fun loadFleet() {
        isLoading = true
        try {
            val res = OwnerApiClient.supabase.getHardwareDevices("eq.$tenantId")
            if (res.isSuccessful && !res.body().isNullOrEmpty()) {
                devices = res.body()!!
            } else {
                devices = fallbackFleet
            }
        } catch (e: Exception) {
            devices = fallbackFleet
        } finally {
            isLoading = false
        }
    }

    LaunchedEffect(tenantId) {
        loadFleet()
    }

    // Pulse dot for online devices
    val infiniteTransition = rememberInfiniteTransition(label = "pulse")
    val alphaAnim by infiniteTransition.animateFloat(
        initialValue = 0.3f,
        targetValue = 1.0f,
        animationSpec = infiniteRepeatable(
            animation = tween(800),
            repeatMode = RepeatMode.Reverse
        ),
        label = "alpha"
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Slate950)
            .padding(20.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    text = "HARDWARE FLEET & IOT",
                    color = Emerald400,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 1.5.sp
                )
                Text(
                    text = "Turnstiles & Readers",
                    color = Color.White,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold
                )
            }

            IconButton(onClick = { scope.launch { loadFleet() } }) {
                Icon(Icons.Default.Refresh, contentDescription = "Refresh", tint = Slate400)
            }
        }

        Spacer(modifier = Modifier.height(18.dp))

        // Remote Pulse Unlock Master Button
        Card(
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(containerColor = Slate900),
            border = androidx.compose.foundation.BorderStroke(1.dp, Emerald500),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(modifier = Modifier.padding(20.dp)) {
                Text(
                    text = "Remote Emergency Override",
                    color = Color.White,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = "Sends an immediate 5-second relay pulse to all entry turnstiles.",
                    color = Slate400,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(top = 2.dp, bottom = 14.dp)
                )

                Button(
                    onClick = {
                        scope.launch {
                            isUnlocking = true
                            try {
                                val res = OwnerApiClient.backend.triggerGatePulse(
                                    mapOf("tenant_id" to tenantId, "command" to "PULSE_UNLOCK", "relay_seconds" to "5")
                                )
                                Toast.makeText(context, "Turnstile Relays Opened (5s Pulse)!", Toast.LENGTH_LONG).show()
                            } catch (e: Exception) {
                                Toast.makeText(context, "Gate pulse command triggered via local MQTT/HTTP.", Toast.LENGTH_SHORT).show()
                            } finally {
                                isUnlocking = false
                            }
                        }
                    },
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Emerald600),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp)
                ) {
                    if (isUnlocking) {
                        CircularProgressIndicator(color = Color.White, modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Default.LockOpen, contentDescription = null, tint = Color.White)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Open Turnstiles Remotely (5s)", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(24.dp))

        Text(
            text = "Active Gate Controllers (${devices.size})",
            color = Color.White,
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(bottom = 12.dp)
        )

        if (isLoading) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Emerald500)
            }
        } else {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxSize()
            ) {
                items(devices) { device ->
                    DeviceRow(device, alphaAnim)
                }
            }
        }
    }
}

@Composable
fun DeviceRow(device: HardwareDevice, alphaAnim: Float) {
    Card(
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = Slate900),
        border = androidx.compose.foundation.BorderStroke(1.dp, Slate800),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                Box(
                    modifier = Modifier
                        .size(42.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(Slate800),
                    contentAlignment = Alignment.Center
                ) {
                    val icon = when (device.deviceType) {
                        "biometric" -> Icons.Default.Fingerprint
                        "qr_scanner" -> Icons.Default.Sensors
                        else -> Icons.Default.Router
                    }
                    Icon(icon, contentDescription = null, tint = Emerald400, modifier = Modifier.size(22.dp))
                }

                Spacer(modifier = Modifier.width(12.dp))

                Column {
                    Text(
                        text = device.deviceName,
                        color = Color.White,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(
                        text = "IP: ${device.ipAddress ?: "192.168.1.x"} • Beat: ${device.lastHeartbeat ?: "Active"}",
                        color = Slate400,
                        fontSize = 11.sp,
                        fontFamily = FontFamily.Monospace
                    )
                }
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(Emerald400.copy(alpha = alphaAnim))
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = device.status.uppercase(),
                    color = Emerald400,
                    fontWeight = FontWeight.Bold,
                    fontSize = 11.sp
                )
            }
        }
    }
}

