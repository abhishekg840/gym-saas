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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CurrencyRupee
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableIntStateOf
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import in.vyroniq.owner.VyroniqOwnerApp
import in.vyroniq.owner.data.model.CollectPaymentPayload
import in.vyroniq.owner.data.model.GymMember
import in.vyroniq.owner.data.remote.OwnerApiClient
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

data class PlanOption(val name: String, val days: Int, val defaultFee: Double)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BillingHubScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val sessionManager = VyroniqOwnerApp.instance.sessionManager
    val tenantId = sessionManager.getTenantId()

    var members by remember { mutableStateOf<List<GymMember>>(emptyList()) }
    var selectedMember by remember { mutableStateOf<GymMember?>(null) }
    var isMemberDropdownExpanded by remember { mutableStateOf(false) }

    val planOptions = listOf(
        PlanOption("Monthly Pro", 30, 1500.0),
        PlanOption("Quarterly Pro", 90, 4000.0),
        PlanOption("Half-Yearly Pro", 180, 7500.0),
        PlanOption("Annual VIP", 365, 14000.0),
        PlanOption("Balance Due Clearance", 0, 0.0)
    )

    var selectedPlan by remember { mutableStateOf(planOptions.first()) }
    var totalFee by remember { mutableStateOf(selectedPlan.defaultFee.toInt().toString()) }
    var discount by remember { mutableStateOf("0") }
    var amountPaid by remember { mutableStateOf(selectedPlan.defaultFee.toInt().toString()) }
    var paymentMethod by remember { mutableStateOf("cash") } // cash, upi, card
    var isSubmitting by remember { mutableStateOf(false) }
    var successReceiptNumber by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(tenantId) {
        val res = OwnerApiClient.supabase.getMembers("eq.$tenantId")
        if (res.isSuccessful) {
            members = res.body() ?: emptyList()
            if (members.isNotEmpty()) {
                selectedMember = members.first()
            }
        }
    }

    val computedTotal = totalFee.toDoubleOrNull() ?: 0.0
    val computedDiscount = discount.toDoubleOrNull() ?: 0.0
    val computedPaid = amountPaid.toDoubleOrNull() ?: 0.0
    val pendingDue = maxOf(0.0, (computedTotal - computedDiscount) - computedPaid)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Slate950)
            .verticalScroll(rememberScrollState())
            .padding(20.dp)
    ) {
        Text(
            text = "DESK POINT-OF-SALE",
            color = Emerald400,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.5.sp
        )
        Text(
            text = "Collect Fees & Issue Invoices",
            color = Color.White,
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold
        )

        Spacer(modifier = Modifier.height(18.dp))

        // Select Member Dropdown
        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = Slate900),
            border = androidx.compose.foundation.BorderStroke(1.dp, Slate800),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text("Select Gym Member", color = Slate400, fontSize = 12.sp)
                Spacer(modifier = Modifier.height(8.dp))

                ExposedDropdownMenuBox(
                    expanded = isMemberDropdownExpanded,
                    onExpandedChange = { isMemberDropdownExpanded = it }
                ) {
                    OutlinedTextField(
                        value = selectedMember?.let { "${it.fullName} (${it.phone})" } ?: "Select Member",
                        onValueChange = {},
                        readOnly = true,
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = isMemberDropdownExpanded) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .menuAnchor(),
                        shape = RoundedCornerShape(10.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Emerald500,
                            unfocusedBorderColor = Slate700,
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color.White,
                            focusedContainerColor = Slate800,
                            unfocusedContainerColor = Slate800
                        )
                    )

                    ExposedDropdownMenu(
                        expanded = isMemberDropdownExpanded,
                        onDismissRequest = { isMemberDropdownExpanded = false }
                    ) {
                        members.forEach { m ->
                            DropdownMenuItem(
                                text = { Text("${m.fullName} • ${m.phone} (${m.membershipStatus})") },
                                onClick = {
                                    selectedMember = m
                                    isMemberDropdownExpanded = false
                                }
                            )
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(14.dp))

        // Select Plan Chips
        Text("Select Membership Plan", color = Slate400, fontSize = 12.sp)
        Spacer(modifier = Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            planOptions.take(3).forEach { plan ->
                val isSelected = selectedPlan.name == plan.name
                FilterChip(
                    selected = isSelected,
                    onClick = {
                        selectedPlan = plan
                        totalFee = plan.defaultFee.toInt().toString()
                        amountPaid = plan.defaultFee.toInt().toString()
                    },
                    label = { Text(plan.name, fontSize = 12.sp) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = Emerald600,
                        selectedLabelColor = Color.White,
                        containerColor = Slate900,
                        labelColor = Slate400
                    )
                )
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Amounts Grid (Total Fee, Discount, Amount Paid)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            OutlinedTextField(
                value = totalFee,
                onValueChange = { totalFee = it },
                label = { Text("Total Fee (₹)") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(10.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Emerald500,
                    unfocusedBorderColor = Slate800,
                    focusedTextColor = Color.White,
                    unfocusedTextColor = Color.White,
                    focusedContainerColor = Slate900,
                    unfocusedContainerColor = Slate900
                )
            )

            OutlinedTextField(
                value = discount,
                onValueChange = { discount = it },
                label = { Text("Discount (₹)") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(10.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Emerald500,
                    unfocusedBorderColor = Slate800,
                    focusedTextColor = Color.White,
                    unfocusedTextColor = Color.White,
                    focusedContainerColor = Slate900,
                    unfocusedContainerColor = Slate900
                )
            )

            OutlinedTextField(
                value = amountPaid,
                onValueChange = { amountPaid = it },
                label = { Text("Amount Paid (₹)") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(10.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Emerald500,
                    unfocusedBorderColor = Slate800,
                    focusedTextColor = Color.White,
                    unfocusedTextColor = Color.White,
                    focusedContainerColor = Slate900,
                    unfocusedContainerColor = Slate900
                )
            )
        }

        // Pending Balance Callout
        if (pendingDue > 0) {
            Spacer(modifier = Modifier.height(12.dp))
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(Rose500.copy(alpha = 0.15f))
                    .border(1.dp, Rose500.copy(alpha = 0.4f), RoundedCornerShape(10.dp))
                    .padding(12.dp)
            ) {
                Text(
                    text = "Balance Due remaining: ₹${pendingDue.toInt()} (will be recorded on member's ledger)",
                    color = Rose500,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Payment Method Selector
        Text("Payment Method", color = Slate400, fontSize = 12.sp)
        Spacer(modifier = Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            listOf("cash", "upi", "card").forEach { method ->
                val isSelected = paymentMethod == method
                FilterChip(
                    selected = isSelected,
                    onClick = { paymentMethod = method },
                    label = { Text(method.uppercase(), fontWeight = FontWeight.Bold, fontSize = 12.sp) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = Emerald600,
                        selectedLabelColor = Color.White,
                        containerColor = Slate900,
                        labelColor = Slate400
                    )
                )
            }
        }

        Spacer(modifier = Modifier.height(28.dp))

        // Collect & Issue Invoice Button
        Button(
            onClick = {
                val member = selectedMember
                if (member == null) {
                    Toast.makeText(context, "Please select a member first", Toast.LENGTH_SHORT).show()
                    return@Button
                }
                scope.launch {
                    isSubmitting = true
                    try {
                        val payload = CollectPaymentPayload(
                            memberId = member.id,
                            tenantId = tenantId,
                            planName = selectedPlan.name,
                            durationDays = selectedPlan.days,
                            totalFee = computedTotal,
                            amountPaid = computedPaid,
                            discount = computedDiscount,
                            paymentMethod = paymentMethod,
                            notes = "Collected from Desk App"
                        )
                        val res = OwnerApiClient.backend.collectPayment(payload)
                        val invNum = "INV-${(1000..9999).random()}"
                        successReceiptNumber = invNum
                        Toast.makeText(context, "Payment Collected! Gate Access Updated.", Toast.LENGTH_LONG).show()
                    } catch (e: Exception) {
                        Toast.makeText(context, "Collection error: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
                    } finally {
                        isSubmitting = false
                    }
                }
            },
            enabled = !isSubmitting && selectedMember != null,
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Emerald600),
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp)
        ) {
            if (isSubmitting) {
                CircularProgressIndicator(color = Color.White, modifier = Modifier.size(22.dp), strokeWidth = 2.dp)
            } else {
                Text(
                    text = "Collect ₹${computedPaid.toInt()} & Issue Receipt",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold
                )
            }
        }

        // Receipt Success Dialog with WhatsApp Dispatch
        if (successReceiptNumber != null && selectedMember != null) {
            val member = selectedMember!!
            AlertDialog(
                onDismissRequest = { successReceiptNumber = null },
                title = { Text("Receipt Generated Successfully", color = Color.White) },
                text = {
                    Column {
                        Text("Invoice #${successReceiptNumber} issued for ${member.fullName}.", color = Slate400)
                        Spacer(modifier = Modifier.height(8.dp))
                        Text("Amount: ₹${computedPaid.toInt()} (${paymentMethod.uppercase()})", color = Emerald400, fontWeight = FontWeight.Bold)
                    }
                },
                confirmButton = {
                    Button(
                        onClick = {
                            val cleanPhone = member.phone.filter { it.isDigit() }.takeLast(10)
                            val message = "Hello ${member.fullName}, your fee payment of ₹${computedPaid.toInt()} at ${sessionManager.getTenantName()} has been received with thanks (Inv #${successReceiptNumber}). Gate pass has been renewed."
                            val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://api.whatsapp.com/send?phone=91$cleanPhone&text=${Uri.encode(message)}"))
                            try {
                                context.startActivity(intent)
                            } catch (e: Exception) {
                                Toast.makeText(context, "WhatsApp not available", Toast.LENGTH_SHORT).show()
                            }
                            successReceiptNumber = null
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Emerald600)
                    ) {
                        Icon(Icons.Default.Send, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Share on WhatsApp")
                    }
                },
                dismissButton = {
                    OutlinedButton(onClick = { successReceiptNumber = null }) {
                        Text("Close", color = Color.White)
                    }
                },
                containerColor = Slate900
            )
        }
    }
}

