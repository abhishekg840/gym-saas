package `in`.vyroniq.member.ui.screens

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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.LocalCafe
import androidx.compose.material.icons.filled.ShoppingBag
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import `in`.vyroniq.member.VyroniqMemberApp
import `in`.vyroniq.member.data.model.PickupOrderRequest
import `in`.vyroniq.member.data.model.StoreProduct
import `in`.vyroniq.member.data.remote.VyroniqApiClient
import `in`.vyroniq.member.ui.theme.Emerald400
import `in`.vyroniq.member.ui.theme.Emerald500
import `in`.vyroniq.member.ui.theme.Emerald600
import `in`.vyroniq.member.ui.theme.Slate400
import `in`.vyroniq.member.ui.theme.Slate700
import `in`.vyroniq.member.ui.theme.Slate800
import `in`.vyroniq.member.ui.theme.Slate900
import `in`.vyroniq.member.ui.theme.Slate950
import kotlinx.coroutines.launch

@Composable
fun StoreScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val sessionManager = VyroniqMemberApp.instance.sessionManager
    val profile = sessionManager.getProfile()
    val tenantId = profile?.tenantId ?: "default"

    var products by remember { mutableStateOf<List<StoreProduct>>(emptyList()) }
    var selectedCategory by remember { mutableStateOf("All") }
    var isLoading by remember { mutableStateOf(true) }
    var pickupOrderCode by remember { mutableStateOf<String?>(null) }

    val categories = listOf("All", "Proteins", "Pre-Workout", "Creatine", "Merch")

    // Default supplement items fallback if inventory table is being seeded
    val fallbackProducts = listOf(
        StoreProduct("1", "Gold Standard 100% Whey (2 lb)", "Proteins", 3299.0, null, true, "Double Rich Chocolate Whey Isolate"),
        StoreProduct("2", "Creatine Monohydrate 250g", "Creatine", 899.0, null, true, "Micronized Unflavored Muscle Builder"),
        StoreProduct("3", "C4 Original Pre-Workout", "Pre-Workout", 2199.0, null, true, "Explosive Energy & Beta-Alanine (30 Servings)"),
        StoreProduct("4", "Chilled Protein Shake (Ready-to-Drink)", "Proteins", 180.0, null, true, "Freshly blended at the front desk bar"),
        StoreProduct("5", "Vyroniq Pro Gym Shaker 700ml", "Merch", 349.0, null, true, "Leak-proof stainless steel ball shaker")
    )

    LaunchedEffect(tenantId) {
        try {
            val response = VyroniqApiClient.supabase.getStoreProducts("eq.$tenantId")
            if (response.isSuccessful && !response.body().isNullOrEmpty()) {
                products = response.body()!!
            } else {
                products = fallbackProducts
            }
        } catch (e: Exception) {
            products = fallbackProducts
        } finally {
            isLoading = false
        }
    }

    val filteredProducts = if (selectedCategory == "All") {
        products
    } else {
        products.filter { it.category.equals(selectedCategory, ignoreCase = true) }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Slate950)
            .padding(20.dp)
    ) {
        Text(
            text = "GYM DESK STORE",
            color = Emerald400,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.5.sp
        )
        Text(
            text = "Supplements & Pickups",
            color = Color.White,
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold
        )

        Spacer(modifier = Modifier.height(14.dp))

        // Category Filter Chips
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(categories) { cat ->
                val isSelected = selectedCategory == cat
                FilterChip(
                    selected = isSelected,
                    onClick = { selectedCategory = cat },
                    label = { Text(cat, fontSize = 13.sp) },
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

        Spacer(modifier = Modifier.height(16.dp))

        if (isLoading) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Emerald500)
            }
        } else {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxSize()
            ) {
                items(filteredProducts) { item ->
                    StoreProductItem(item) {
                        // Instant Pickup Order Generation
                        val pickupNum = (1000..9999).random()
                        pickupOrderCode = "PICKUP-$pickupNum"
                    }
                }
            }
        }

        // Pickup Confirmation Dialog
        if (pickupOrderCode != null) {
            AlertDialog(
                onDismissRequest = { pickupOrderCode = null },
                confirmButton = {
                    Button(
                        onClick = { pickupOrderCode = null },
                        colors = ButtonDefaults.buttonColors(containerColor = Emerald600)
                    ) {
                        Text("Done")
                    }
                },
                title = { Text("Desk Pickup Order Confirmed", color = Color.White) },
                text = {
                    Column {
                        Text("Show this code at the front desk till to collect your item:", color = Slate400)
                        Spacer(modifier = Modifier.height(12.dp))
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .background(Slate800)
                                .padding(14.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = pickupOrderCode!!,
                                color = Emerald400,
                                fontSize = 24.sp,
                                fontWeight = FontWeight.ExtraBold,
                                letterSpacing = 2.sp
                            )
                        }
                    }
                },
                containerColor = Slate900
            )
        }
    }
}

@Composable
fun StoreProductItem(item: StoreProduct, onOrder: () -> Unit) {
    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = Slate900),
        border = androidx.compose.foundation.BorderStroke(1.dp, Slate800),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                Box(
                    modifier = Modifier
                        .size(46.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(Slate800),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.ShoppingBag,
                        contentDescription = null,
                        tint = Emerald400,
                        modifier = Modifier.size(22.dp)
                    )
                }

                Spacer(modifier = Modifier.width(14.dp))

                Column {
                    Text(
                        text = item.name,
                        color = Color.White,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(
                        text = item.description ?: item.category,
                        color = Slate400,
                        fontSize = 12.sp,
                        maxLines = 1
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "₹${item.price.toInt()}",
                        color = Emerald400,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }

            Button(
                onClick = onOrder,
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Emerald600),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp, vertical = 6.dp),
                modifier = Modifier.height(36.dp)
            ) {
                Text("Pick Up", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Color.White)
            }
        }
    }
}

