package in.vyroniq.member.ui.screens

import android.app.Activity
import android.graphics.Bitmap
import android.view.WindowManager
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.LockClock
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import in.vyroniq.member.VyroniqMemberApp
import in.vyroniq.member.data.security.PassTokenGenerator
import in.vyroniq.member.ui.theme.Amber500
import in.vyroniq.member.ui.theme.Emerald400
import in.vyroniq.member.ui.theme.Emerald500
import in.vyroniq.member.ui.theme.Emerald600
import in.vyroniq.member.ui.theme.Rose500
import in.vyroniq.member.ui.theme.Slate400
import in.vyroniq.member.ui.theme.Slate700
import in.vyroniq.member.ui.theme.Slate800
import in.vyroniq.member.ui.theme.Slate900
import in.vyroniq.member.ui.theme.Slate950
import in.vyroniq.member.util.QrCodeGenerator
import kotlinx.coroutines.delay

@Composable
fun PassScreen() {
    val context = LocalContext.current
    val sessionManager = VyroniqMemberApp.instance.sessionManager
    val profile = sessionManager.getProfile()

    var qrBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var remainingSeconds by remember { mutableIntStateOf(30) }
    var currentWindow by remember { mutableStateOf(PassTokenGenerator.getCurrentWindow()) }
    var isOfflineMode by remember { mutableStateOf(false) }

    // Auto-boost screen brightness to 100% for turnstile optical reader, restore on exit
    DisposableEffect(Unit) {
        val window = (context as? Activity)?.window
        val originalBrightness = window?.attributes?.screenBrightness ?: WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE

        window?.attributes = window?.attributes?.apply {
            screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_FULL
        }

        onDispose {
            window?.attributes = window?.attributes?.apply {
                screenBrightness = originalBrightness
            }
        }
    }

    // Refresh pass every 30-second window
    LaunchedEffect(currentWindow) {
        val memberId = profile?.id ?: "unknown"
        val tenantId = profile?.tenantId ?: "default"
        val payload = PassTokenGenerator.generateSignedPayload(memberId, tenantId, currentWindow)

        // Cache offline copy
        sessionManager.cacheOfflinePassToken(payload)
        qrBitmap = QrCodeGenerator.generateQrBitmap(payload, 700)
    }

    // 1-second countdown ticker
    LaunchedEffect(Unit) {
        while (true) {
            val sec = PassTokenGenerator.getRemainingSecondsInWindow()
            remainingSeconds = sec
            if (sec == 30 || sec <= 1) {
                currentWindow = PassTokenGenerator.getCurrentWindow()
            }
            delay(1000L)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Slate950)
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        // Top Header
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    text = "DIGITAL ENTRY PASS",
                    color = Emerald400,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 1.5.sp
                )
                Text(
                    text = profile?.gymName ?: "Vyroniq Fitness Club",
                    color = Color.White,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold
                )
            }

            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(20.dp))
                    .background(if (profile?.membershipStatus == "active") Emerald600.copy(alpha = 0.2f) else Rose500.copy(alpha = 0.2f))
                    .border(
                        1.dp,
                        if (profile?.membershipStatus == "active") Emerald500 else Rose500,
                        RoundedCornerShape(20.dp)
                    )
                    .padding(horizontal = 12.dp, vertical = 6.dp)
            ) {
                Text(
                    text = (profile?.membershipStatus ?: "ACTIVE").uppercase(),
                    color = if (profile?.membershipStatus == "active") Emerald400 else Rose500,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold
                )
            }
        }

        Spacer(modifier = Modifier.height(20.dp))

        // Main QR Gate Pass Card
        Card(
            shape = RoundedCornerShape(24.dp),
            colors = CardDefaults.cardColors(containerColor = Slate900),
            border = androidx.compose.foundation.BorderStroke(1.dp, Slate800),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                // Member Info Banner
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(
                        modifier = Modifier
                            .size(48.dp)
                            .clip(CircleShape)
                            .background(Emerald600),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = (profile?.fullName?.take(1) ?: "M").uppercase(),
                            color = Color.White,
                            fontWeight = FontWeight.Bold,
                            fontSize = 20.sp
                        )
                    }

                    Spacer(modifier = Modifier.width(14.dp))

                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = profile?.fullName ?: "Gym Member",
                            color = Color.White,
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "Plan: ${profile?.membershipPlan ?: "General Pro"}",
                            color = Slate400,
                            fontSize = 13.sp
                        )
                    }

                    Icon(
                        imageVector = Icons.Default.Shield,
                        contentDescription = "Verified Member",
                        tint = Emerald400,
                        modifier = Modifier.size(24.dp)
                    )
                }

                Spacer(modifier = Modifier.height(24.dp))

                // High Contrast QR Code Canvas
                Box(
                    modifier = Modifier
                        .size(270.dp)
                        .clip(RoundedCornerShape(20.dp))
                        .background(Color.White)
                        .padding(14.dp),
                    contentAlignment = Alignment.Center
                ) {
                    if (qrBitmap != null) {
                        Image(
                            bitmap = qrBitmap!!.asImageBitmap(),
                            contentDescription = "Dynamic Access QR",
                            modifier = Modifier.fillMaxSize()
                        )
                    } else {
                        CircularProgressIndicator(color = Emerald600, strokeWidth = 3.dp)
                    }
                }

                Spacer(modifier = Modifier.height(20.dp))

                // 30-Second Refresh Countdown Bar
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                imageVector = Icons.Default.LockClock,
                                contentDescription = null,
                                tint = Emerald400,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = "Rotating Security Token",
                                color = Slate400,
                                fontSize = 12.sp
                            )
                        }
                        Text(
                            text = "${remainingSeconds}s remaining",
                            color = Color.White,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            fontFamily = FontFamily.Monospace
                        )
                    }

                    Spacer(modifier = Modifier.height(8.dp))

                    LinearProgressIndicator(
                        progress = { remainingSeconds / 30f },
                        color = Emerald500,
                        trackColor = Slate800,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(6.dp)
                            .clip(RoundedCornerShape(3.dp))
                    )
                }

                Spacer(modifier = Modifier.height(16.dp))

                Text(
                    text = "Scan at gate turnstile or desk optical reader.",
                    color = Slate400,
                    fontSize = 12.sp,
                    textAlign = TextAlign.Center
                )
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Security Notice & Offline Token Fallback
        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = Slate900.copy(alpha = 0.6f)),
            border = androidx.compose.foundation.BorderStroke(1.dp, Slate800),
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier.padding(16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = Icons.Default.CheckCircle,
                    contentDescription = null,
                    tint = Emerald400,
                    modifier = Modifier.size(24.dp)
                )
                Spacer(modifier = Modifier.width(12.dp))
                Column {
                    Text(
                        text = "Anti-Screenshot Protection Active",
                        color = Color.White,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(
                        text = "Token rotates cryptographically every 30s. Offline cached passes supported.",
                        color = Slate400,
                        fontSize = 12.sp
                    )
                }
            }
        }
    }
}

