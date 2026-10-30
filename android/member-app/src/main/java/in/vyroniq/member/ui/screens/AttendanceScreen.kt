package in.vyroniq.member.ui.screens

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
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.FitnessCenter
import androidx.compose.material.icons.filled.LocalFireDepartment
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import in.vyroniq.member.VyroniqMemberApp
import in.vyroniq.member.data.model.AttendanceRecord
import in.vyroniq.member.data.remote.VyroniqApiClient
import in.vyroniq.member.ui.theme.Amber500
import in.vyroniq.member.ui.theme.Emerald400
import in.vyroniq.member.ui.theme.Emerald500
import in.vyroniq.member.ui.theme.Emerald600
import in.vyroniq.member.ui.theme.Slate400
import in.vyroniq.member.ui.theme.Slate700
import in.vyroniq.member.ui.theme.Slate800
import in.vyroniq.member.ui.theme.Slate900
import in.vyroniq.member.ui.theme.Slate950
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

@Composable
fun AttendanceScreen() {
    val sessionManager = VyroniqMemberApp.instance.sessionManager
    val memberId = sessionManager.getMemberId() ?: ""

    var history by remember { mutableStateOf<List<AttendanceRecord>>(emptyList()) }
    var activeSession by remember { mutableStateOf<AttendanceRecord?>(null) }
    var isLoading by remember { mutableStateOf(true) }
    var elapsedSeconds by remember { mutableLongStateOf(0L) }

    suspend fun loadAttendance() {
        isLoading = true
        try {
            val historyRes = VyroniqApiClient.supabase.getAttendanceHistory("eq.$memberId")
            if (historyRes.isSuccessful) {
                history = historyRes.body() ?: emptyList()
            }

            val activeRes = VyroniqApiClient.supabase.getActiveAttendanceSession("eq.$memberId")
            if (activeRes.isSuccessful && !activeRes.body().isNullOrEmpty()) {
                activeSession = activeRes.body()!!.first()
            } else {
                activeSession = null
            }
        } catch (e: Exception) {
            e.printStackTrace()
        } finally {
            isLoading = false
        }
    }

    LaunchedEffect(memberId) {
        loadAttendance()
    }

    // Live workout timer when active
    LaunchedEffect(activeSession) {
        val checkIn = activeSession?.checkInTime
        if (checkIn != null) {
            val checkInMs = parseIsoDate(checkIn)
            while (activeSession != null) {
                val now = System.currentTimeMillis()
                elapsedSeconds = maxOf(0L, (now - checkInMs) / 1000L)
                delay(1000L)
            }
        }
    }

    // Pulse animation for active session
    val infiniteTransition = rememberInfiniteTransition(label = "pulse")
    val alphaAnim by infiniteTransition.animateFloat(
        initialValue = 0.4f,
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
        // Header
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    text = "WORKOUT TRACKER",
                    color = Emerald400,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 1.5.sp
                )
                Text(
                    text = "Attendance & Streaks",
                    color = Color.White,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold
                )
            }

            IconButton(
                onClick = { /* trigger reload */ }
            ) {
                Icon(Icons.Default.Refresh, contentDescription = "Refresh", tint = Slate400)
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Active Floor Session Card (if checked in)
        if (activeSession != null) {
            Card(
                shape = RoundedCornerShape(20.dp),
                colors = CardDefaults.cardColors(containerColor = Slate900),
                border = androidx.compose.foundation.BorderStroke(1.dp, Emerald500),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Box(
                            modifier = Modifier
                                .size(12.dp)
                                .clip(CircleShape)
                                .background(Emerald400.copy(alpha = alphaAnim))
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "CURRENTLY ON GYM FLOOR",
                            color = Emerald400,
                            fontWeight = FontWeight.Bold,
                            fontSize = 12.sp,
                            letterSpacing = 1.sp
                        )
                    }

                    Spacer(modifier = Modifier.height(12.dp))

                    Text(
                        text = formatTimer(elapsedSeconds),
                        color = Color.White,
                        fontSize = 36.sp,
                        fontWeight = FontWeight.ExtraBold,
                        fontFamily = FontFamily.Monospace
                    )

                    Spacer(modifier = Modifier.height(6.dp))

                    Text(
                        text = "Checked in at ${formatTimeOnly(activeSession?.checkInTime)}",
                        color = Slate400,
                        fontSize = 12.sp
                    )
                }
            }
            Spacer(modifier = Modifier.height(16.dp))
        }

        // Consistency Streak Card
        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = Slate900),
            border = androidx.compose.foundation.BorderStroke(1.dp, Slate800),
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier.padding(16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .size(44.dp)
                        .clip(CircleShape)
                        .background(Amber500.copy(alpha = 0.15f)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.LocalFireDepartment,
                        contentDescription = "Streak",
                        tint = Amber500,
                        modifier = Modifier.size(24.dp)
                    )
                }

                Spacer(modifier = Modifier.width(14.dp))

                Column {
                    Text(
                        text = "14-Day Consistency Streak",
                        color = Color.White,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = "Great discipline! 18 sessions logged this month.",
                        color = Slate400,
                        fontSize = 12.sp
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(20.dp))

        Text(
            text = "Punch History",
            color = Color.White,
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(bottom = 12.dp)
        )

        if (isLoading) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Emerald500)
            }
        } else if (history.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(32.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "No workouts recorded yet.\nScan your Entry Pass at the gate to start!",
                    color = Slate400,
                    fontSize = 14.sp,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center
                )
            }
        } else {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxSize()
            ) {
                items(history) { record ->
                    AttendanceItem(record)
                }
            }
        }
    }
}

@Composable
fun AttendanceItem(record: AttendanceRecord) {
    Card(
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = Slate900),
        border = androidx.compose.foundation.BorderStroke(1.dp, Slate800),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(38.dp)
                        .clip(CircleShape)
                        .background(Emerald600.copy(alpha = 0.2f)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.FitnessCenter,
                        contentDescription = null,
                        tint = Emerald400,
                        modifier = Modifier.size(18.dp)
                    )
                }

                Spacer(modifier = Modifier.width(12.dp))

                Column {
                    Text(
                        text = formatDateOnly(record.checkInTime),
                        color = Color.White,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(
                        text = "In: ${formatTimeOnly(record.checkInTime)} • Out: ${record.checkOutTime?.let { formatTimeOnly(it) } ?: "Active"}",
                        color = Slate400,
                        fontSize = 12.sp
                    )
                }
            }

            if (record.checkOutTime != null) {
                val durationMins = calculateDurationMins(record.checkInTime, record.checkOutTime)
                Text(
                    text = "${durationMins}m",
                    color = Emerald400,
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp
                )
            } else {
                Text(
                    text = "ONGOING",
                    color = Amber500,
                    fontWeight = FontWeight.Bold,
                    fontSize = 11.sp
                )
            }
        }
    }
}

private fun parseIsoDate(iso: String): Long {
    return try {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
        val clean = iso.substringBefore("+").substringBefore("Z")
        sdf.parse(clean)?.time ?: System.currentTimeMillis()
    } catch (e: Exception) {
        System.currentTimeMillis()
    }
}

private fun formatTimer(seconds: Long): String {
    val hrs = seconds / 3600
    val mins = (seconds % 3600) / 60
    val secs = seconds % 60
    return String.format(Locale.US, "%02d:%02d:%02d", hrs, mins, secs)
}

private fun formatDateOnly(iso: String): String {
    return try {
        val ms = parseIsoDate(iso)
        val sdf = SimpleDateFormat("EEE, dd MMM yyyy", Locale.getDefault())
        sdf.format(Date(ms))
    } catch (e: Exception) {
        iso
    }
}

private fun formatTimeOnly(iso: String?): String {
    if (iso == null) return "—"
    return try {
        val ms = parseIsoDate(iso)
        val sdf = SimpleDateFormat("hh:mm a", Locale.getDefault())
        sdf.format(Date(ms))
    } catch (e: Exception) {
        "—"
    }
}

private fun calculateDurationMins(startIso: String, endIso: String): Long {
    val start = parseIsoDate(startIso)
    val end = parseIsoDate(endIso)
    return maxOf(0L, (end - start) / (1000L * 60L))
}

