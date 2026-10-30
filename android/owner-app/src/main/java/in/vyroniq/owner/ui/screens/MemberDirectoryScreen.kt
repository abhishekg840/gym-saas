package in.vyroniq.owner.ui.screens

import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Update
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import in.vyroniq.owner.VyroniqOwnerApp
import in.vyroniq.owner.data.model.CollectPaymentPayload
import in.vyroniq.owner.data.model.DeleteMemberPayload
import in.vyroniq.owner.data.model.GymMember
import in.vyroniq.owner.data.remote.OwnerApiClient
import in.vyroniq.owner.ui.theme.Amber500
import in.vyroniq.owner.ui.theme.Emerald400
import in.vyroniq.owner.ui.theme.Emerald500
import in.vyroniq.owner.ui.theme.Emerald600
import in.vyroniq.owner.ui.theme.Rose500
import in.vyroniq.owner.ui.theme.Slate400
import in.vyroniq.owner.ui.theme.Slate700
import in.vyroniq.owner.ui.theme.Slate800
import in.vyroniq.owner.ui.theme.Slate900
import in.vyroniq.owner.ui.theme.Slate950
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MemberDirectoryScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val sessionManager = VyroniqOwnerApp.instance.sessionManager
    val tenantId = sessionManager.getTenantId()

    var searchQuery by remember { mutableStateOf("") }
    var selectedFilter by remember { mutableStateOf("All") }
    var members by remember { mutableStateOf<List<GymMember>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }

    var selectedMemberForAction by remember { mutableStateOf<GymMember?>(null) }
    var showDeleteConfirmDialog by remember { mutableStateOf(false) }

    suspend fun loadMembers() {
        isLoading = true
        try {
            val res = OwnerApiClient.supabase.getMembers("eq.$tenantId")
            if (res.isSuccessful) {
                members = res.body() ?: emptyList()
            }
        } catch (e: Exception) {
            e.printStackTrace()
        } finally {
            isLoading = false
        }
    }

    LaunchedEffect(tenantId) {
        loadMembers()
    }

    val filterOptions = listOf("All", "Active", "Overdue", "Expiring Soon")

    val filteredMembers = members.filter { m ->
        val matchesSearch = m.fullName.contains(searchQuery, ignoreCase = true) ||
                m.phone.contains(searchQuery, ignoreCase = true) ||
                (m.rfidTag?.contains(searchQuery, ignoreCase = true) == true)

        val matchesFilter = when (selectedFilter) {
            "Active" -> m.membershipStatus == "active"
            "Overdue" -> m.pendingDues > 0 || m.membershipStatus == "overdue"
            "Expiring Soon" -> {
                val days = calculateDaysRemaining(m.membershipEnd)
                days in 0..7
            }
            else -> true
        }

        matchesSearch && matchesFilter
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Slate950)
            .padding(20.dp)
    ) {
        Text(
            text = "MEMBERS DIRECTORY",
            color = Emerald400,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.5.sp
        )
        Text(
            text = "Member Lifecycle & Dues",
            color = Color.White,
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold
        )

        Spacer(modifier = Modifier.height(14.dp))

        // Search Bar
        OutlinedTextField(
            value = searchQuery,
            onValueChange = { searchQuery = it },
            placeholder = { Text("Search by name, phone, or RFID card...", color = Slate400, fontSize = 14.sp) },
            leadingIcon = {
                Icon(Icons.Default.Search, contentDescription = null, tint = Emerald500, modifier = Modifier.size(20.dp))
            },
            singleLine = true,
            shape = RoundedCornerShape(12.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Emerald500,
                unfocusedBorderColor = Slate800,
                focusedTextColor = Color.White,
                unfocusedTextColor = Color.White,
                focusedContainerColor = Slate900,
                unfocusedContainerColor = Slate900
            ),
            modifier = Modifier.fillMaxWidth()
        )

        Spacer(modifier = Modifier.height(12.dp))

        // Filter Chips
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(filterOptions) { filter ->
                val isSelected = selectedFilter == filter
                FilterChip(
                    selected = isSelected,
                    onClick = { selectedFilter = filter },
                    label = { Text(filter, fontSize = 12.sp) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = Emerald600,
                        selectedLabelColor = Color.White,
                        containerColor = Slate900,
                        labelColor = Slate400
                    ),
                    border = FilterChipDefaults.filterChipBorder(
                        enabled = true,
                        selected = isSelected,
                        borderColor = if (isSelected) Emerald500 else Slate800
                    )
                )
            }
        }

        Spacer(modifier = Modifier.height(14.dp))

        if (isLoading) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Emerald500)
            }
        } else if (filteredMembers.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("No matching members found.", color = Slate400, fontSize = 14.sp)
            }
        } else {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxSize()
            ) {
                items(filteredMembers) { member ->
                    MemberRowItem(member) {
                        selectedMemberForAction = member
                    }
                }
            }
        }

        // Member Action BottomSheet
        if (selectedMemberForAction != null) {
            val member = selectedMemberForAction!!
            ModalBottomSheet(
                onDismissRequest = { selectedMemberForAction = null },
                containerColor = Slate900
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(24.dp)
                ) {
                    Text(
                        text = member.fullName,
                        color = Color.White,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = "Phone: ${member.phone} • Plan: ${member.membershipPlan ?: "Pro"}",
                        color = Slate400,
                        fontSize = 13.sp
                    )
                    if (member.pendingDues > 0) {
                        Text(
                            text = "Pending Dues: ₹${member.pendingDues.toInt()}",
                            color = Rose500,
                            fontWeight = FontWeight.Bold,
                            fontSize = 13.sp,
                            modifier = Modifier.padding(top = 2.dp)
                        )
                    }

                    Spacer(modifier = Modifier.height(20.dp))

                    // +30 Days Extension
                    Button(
                        onClick = {
                            scope.launch {
                                val payload = CollectPaymentPayload(
                                    memberId = member.id,
                                    tenantId = tenantId,
                                    planName = member.membershipPlan ?: "Monthly Extension",
                                    durationDays = 30,
                                    totalFee = 1500.0,
                                    amountPaid = 1500.0,
                                    paymentMethod = "cash",
                                    notes = "Instant +30d extension from Owner App"
                                )
                                val res = OwnerApiClient.backend.collectPayment(payload)
                                Toast.makeText(context, "+30 Days Renewal Applied & Gate Access Extended!", Toast.LENGTH_LONG).show()
                                selectedMemberForAction = null
                                loadMembers()
                            }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Emerald600),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth().height(46.dp)
                    ) {
                        Icon(Icons.Default.Update, contentDescription = null, tint = Color.White)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Renew +30 Days (Instant)", fontWeight = FontWeight.Bold)
                    }

                    Spacer(modifier = Modifier.height(10.dp))

                    // +90 Days Extension
                    Button(
                        onClick = {
                            scope.launch {
                                val payload = CollectPaymentPayload(
                                    memberId = member.id,
                                    tenantId = tenantId,
                                    planName = "Quarterly Extension",
                                    durationDays = 90,
                                    totalFee = 4000.0,
                                    amountPaid = 4000.0,
                                    paymentMethod = "cash",
                                    notes = "Instant +90d extension from Owner App"
                                )
                                val res = OwnerApiClient.backend.collectPayment(payload)
                                Toast.makeText(context, "+90 Days Renewal Applied!", Toast.LENGTH_LONG).show()
                                selectedMemberForAction = null
                                loadMembers()
                            }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Slate800),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth().height(46.dp)
                    ) {
                        Icon(Icons.Default.Update, contentDescription = null, tint = Emerald400)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Renew +90 Days (Quarterly)", color = Color.White, fontWeight = FontWeight.SemiBold)
                    }

                    Spacer(modifier = Modifier.height(10.dp))

                    // WhatsApp Reminder Intent
                    OutlinedButton(
                        onClick = {
                            val cleanPhone = member.phone.filter { it.isDigit() }.takeLast(10)
                            val message = "Hello ${member.fullName}, your gym membership at ${sessionManager.getTenantName()} is expiring on ${formatDate(member.membershipEnd)}. Outstanding dues: ₹${member.pendingDues.toInt()}. Please renew to avoid gate access block."
                            val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://api.whatsapp.com/send?phone=91$cleanPhone&text=${Uri.encode(message)}"))
                            try {
                                context.startActivity(intent)
                            } catch (e: Exception) {
                                Toast.makeText(context, "WhatsApp is not installed on this device.", Toast.LENGTH_SHORT).show()
                            }
                        },
                        shape = RoundedCornerShape(10.dp),
                        border = androidx.compose.foundation.BorderStroke(1.dp, Slate700),
                        modifier = Modifier.fillMaxWidth().height(46.dp)
                    ) {
                        Icon(Icons.Default.Send, contentDescription = null, tint = Emerald400)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Send WhatsApp Due Reminder", color = Color.White)
                    }

                    Spacer(modifier = Modifier.height(10.dp))

                    // Delete Member
                    Button(
                        onClick = { showDeleteConfirmDialog = true },
                        colors = ButtonDefaults.buttonColors(containerColor = Slate950),
                        border = androidx.compose.foundation.BorderStroke(1.dp, Rose500.copy(alpha = 0.5f)),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth().height(46.dp)
                    ) {
                        Icon(Icons.Default.Delete, contentDescription = null, tint = Rose500)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Hard Delete Member", color = Rose500)
                    }
                }
            }
        }

        // Delete Confirmation Modal
        if (showDeleteConfirmDialog && selectedMemberForAction != null) {
            val member = selectedMemberForAction!!
            AlertDialog(
                onDismissRequest = { showDeleteConfirmDialog = false },
                title = { Text("Delete ${member.fullName}?", color = Color.White) },
                text = { Text("This will permanently remove the member, cancel gate passes, and archive attendance logs.", color = Slate400) },
                confirmButton = {
                    Button(
                        onClick = {
                            scope.launch {
                                try {
                                    val res = OwnerApiClient.backend.deleteMember(
                                        DeleteMemberPayload(memberId = member.id, tenantId = tenantId)
                                    )
                                    Toast.makeText(context, "Member deleted.", Toast.LENGTH_SHORT).show()
                                    showDeleteConfirmDialog = false
                                    selectedMemberForAction = null
                                    loadMembers()
                                } catch (e: Exception) {
                                    Toast.makeText(context, "Delete failed: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
                                }
                            }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Rose500)
                    ) {
                        Text("Confirm Delete")
                    }
                },
                dismissButton = {
                    OutlinedButton(onClick = { showDeleteConfirmDialog = false }) {
                        Text("Cancel", color = Color.White)
                    }
                },
                containerColor = Slate900
            )
        }
    }
}

@Composable
fun MemberRowItem(member: GymMember, onClick: () -> Unit) {
    Card(
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = Slate900),
        border = androidx.compose.foundation.BorderStroke(1.dp, Slate800),
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() }
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
                        .clip(CircleShape)
                        .background(Emerald600),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = member.fullName.take(1).uppercase(),
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                        fontSize = 18.sp
                    )
                }

                Spacer(modifier = Modifier.width(12.dp))

                Column {
                    Text(
                        text = member.fullName,
                        color = Color.White,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(
                        text = "${member.phone} • ${member.membershipPlan ?: "Pro"}",
                        color = Slate400,
                        fontSize = 12.sp
                    )
                    if (member.pendingDues > 0) {
                        Text(
                            text = "Due: ₹${member.pendingDues.toInt()}",
                            color = Rose500,
                            fontWeight = FontWeight.Bold,
                            fontSize = 12.sp
                        )
                    }
                }
            }

            IconButton(onClick = onClick) {
                Icon(Icons.Default.MoreVert, contentDescription = "Actions", tint = Slate400)
            }
        }
    }
}

private fun calculateDaysRemaining(endIso: String?): Int {
    if (endIso.isNullOrBlank()) return 0
    return try {
        val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
        val clean = endIso.substringBefore("T")
        val date = sdf.parse(clean) ?: return 0
        val diff = date.time - System.currentTimeMillis()
        maxOf(0, (diff / (1000L * 60L * 60L * 24L)).toInt())
    } catch (e: Exception) {
        0
    }
}

private fun formatDate(iso: String?): String {
    if (iso.isNullOrBlank()) return "—"
    return try {
        val clean = iso.substringBefore("T")
        val sdfIn = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
        val sdfOut = SimpleDateFormat("dd MMM yyyy", Locale.getDefault())
        val d = sdfIn.parse(clean) ?: return iso
        sdfOut.format(d)
    } catch (e: Exception) {
        iso
    }
}

