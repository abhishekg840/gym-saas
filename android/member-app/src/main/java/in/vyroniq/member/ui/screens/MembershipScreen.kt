package `in`.vyroniq.member.ui.screens

import android.content.Intent
import android.net.Uri
import android.widget.Toast
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
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Receipt
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import `in`.vyroniq.member.VyroniqMemberApp
import `in`.vyroniq.member.data.model.InvoiceRecord
import `in`.vyroniq.member.data.remote.VyroniqApiClient
import `in`.vyroniq.member.ui.theme.Amber500
import `in`.vyroniq.member.ui.theme.Emerald400
import `in`.vyroniq.member.ui.theme.Emerald500
import `in`.vyroniq.member.ui.theme.Emerald600
import `in`.vyroniq.member.ui.theme.Rose500
import `in`.vyroniq.member.ui.theme.Slate400
import `in`.vyroniq.member.ui.theme.Slate700
import `in`.vyroniq.member.ui.theme.Slate800
import `in`.vyroniq.member.ui.theme.Slate900
import `in`.vyroniq.member.ui.theme.Slate950
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun MembershipScreen() {
    val context = LocalContext.current
    val sessionManager = VyroniqMemberApp.instance.sessionManager
    val profile = sessionManager.getProfile()
    val memberId = profile?.id ?: ""

    var invoices by remember { mutableStateOf<List<InvoiceRecord>>(emptyList()) }
    var isLoadingInvoices by remember { mutableStateOf(true) }

    LaunchedEffect(memberId) {
        try {
            val response = VyroniqApiClient.supabase.getInvoices("eq.$memberId")
            if (response.isSuccessful) {
                invoices = response.body() ?: emptyList()
            }
        } catch (e: Exception) {
            e.printStackTrace()
        } finally {
            isLoadingInvoices = false
        }
    }

    val daysLeft = calculateDaysRemaining(profile?.membershipEnd)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Slate950)
            .padding(20.dp)
    ) {
        Text(
            text = "MEMBERSHIP & BILLING",
            color = Emerald400,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.5.sp
        )
        Text(
            text = "Plan & Invoice Ledger",
            color = Color.White,
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold
        )

        Spacer(modifier = Modifier.height(16.dp))

        // Active Membership Hero Card
        Card(
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(containerColor = Slate900),
            border = androidx.compose.foundation.BorderStroke(1.dp, Slate800),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(modifier = Modifier.padding(20.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text(
                            text = profile?.membershipPlan ?: "Annual Gym Membership",
                            color = Color.White,
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "Valid till ${formatDate(profile?.membershipEnd)}",
                            color = Slate400,
                            fontSize = 13.sp
                        )
                    }

                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(12.dp))
                            .background(if (daysLeft > 0) Emerald600.copy(alpha = 0.2f) else Rose500.copy(alpha = 0.2f))
                            .border(1.dp, if (daysLeft > 0) Emerald500 else Rose500, RoundedCornerShape(12.dp))
                            .padding(horizontal = 10.dp, vertical = 6.dp)
                    ) {
                        Text(
                            text = if (daysLeft > 0) "$daysLeft Days Left" else "EXPIRED",
                            color = if (daysLeft > 0) Emerald400 else Rose500,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }

                // Outstanding Dues Alert
                if ((profile?.pendingDues ?: 0.0) > 0) {
                    Spacer(modifier = Modifier.height(16.dp))
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(Rose500.copy(alpha = 0.15f))
                            .border(1.dp, Rose500.copy(alpha = 0.4f), RoundedCornerShape(12.dp))
                            .padding(14.dp)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.Warning, contentDescription = null, tint = Rose500, modifier = Modifier.size(20.dp))
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    text = "Outstanding Due: ₹${profile?.pendingDues?.toInt()}",
                                    color = Color.White,
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                            Button(
                                onClick = {
                                    val upiUri = Uri.parse("upi://pay?pa=gym@upi&pn=${Uri.encode(profile?.gymName ?: "Gym")}&am=${profile?.pendingDues}&cu=INR")
                                    val upiIntent = Intent(Intent.ACTION_VIEW, upiUri)
                                    try {
                                        context.startActivity(upiIntent)
                                    } catch (e: Exception) {
                                        Toast.makeText(context, "No UPI app found. Please pay at front desk.", Toast.LENGTH_SHORT).show()
                                    }
                                },
                                shape = RoundedCornerShape(8.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = Rose500),
                                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                                modifier = Modifier.height(34.dp)
                            ) {
                                Text("Pay Now", fontSize = 12.sp, color = Color.White, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(24.dp))

        Text(
            text = "Payment Receipts & Invoices",
            color = Color.White,
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(bottom = 12.dp)
        )

        if (isLoadingInvoices) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Emerald500)
            }
        } else if (invoices.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(32.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "No invoices on record yet.",
                    color = Slate400,
                    fontSize = 14.sp
                )
            }
        } else {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxSize()
            ) {
                items(invoices) { invoice ->
                    InvoiceItem(invoice) {
                        if (!invoice.pdfUrl.isNullOrBlank()) {
                            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(invoice.pdfUrl))
                            try {
                                context.startActivity(intent)
                            } catch (e: Exception) {
                                Toast.makeText(context, "Cannot open PDF viewer", Toast.LENGTH_SHORT).show()
                            }
                        } else {
                            Toast.makeText(context, "Receipt #${invoice.invoiceNumber} verified.", Toast.LENGTH_SHORT).show()
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun InvoiceItem(invoice: InvoiceRecord, onDownloadPdf: () -> Unit) {
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
                        .background(Slate800),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.Receipt,
                        contentDescription = null,
                        tint = Emerald400,
                        modifier = Modifier.size(18.dp)
                    )
                }

                Spacer(modifier = Modifier.width(12.dp))

                Column {
                    Text(
                        text = "₹${invoice.amountPaid.toInt()} • ${invoice.planName}",
                        color = Color.White,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = "Inv #${invoice.invoiceNumber} • ${invoice.paymentMethod.uppercase()} • ${formatDate(invoice.issuedAt)}",
                        color = Slate400,
                        fontSize = 11.sp
                    )
                }
            }

            OutlinedButton(
                onClick = onDownloadPdf,
                shape = RoundedCornerShape(8.dp),
                border = androidx.compose.foundation.BorderStroke(1.dp, Slate700),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 10.dp, vertical = 2.dp),
                modifier = Modifier.height(32.dp)
            ) {
                Icon(Icons.Default.Download, contentDescription = null, tint = Emerald400, modifier = Modifier.size(14.dp))
                Spacer(modifier = Modifier.width(4.dp))
                Text("PDF", fontSize = 11.sp, color = Color.White)
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

