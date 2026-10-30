package in.vyroniq.owner.ui.screens

import android.widget.Toast
import androidx.compose.foundation.background
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Business
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.FitnessCenter
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.fragment.app.FragmentActivity
import in.vyroniq.owner.VyroniqOwnerApp
import in.vyroniq.owner.data.model.Tenant
import in.vyroniq.owner.data.remote.OwnerApiClient
import in.vyroniq.owner.data.security.BiometricAuthManager
import in.vyroniq.owner.ui.theme.Emerald400
import in.vyroniq.owner.ui.theme.Emerald500
import in.vyroniq.owner.ui.theme.Emerald600
import in.vyroniq.owner.ui.theme.Slate400
import in.vyroniq.owner.ui.theme.Slate700
import in.vyroniq.owner.ui.theme.Slate800
import in.vyroniq.owner.ui.theme.Slate900
import in.vyroniq.owner.ui.theme.Slate950
import kotlinx.coroutines.launch

@Composable
fun OwnerLoginScreen(
    onLoginSuccess: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val sessionManager = VyroniqOwnerApp.instance.sessionManager

    var gymSlug by remember { mutableStateOf("my-fitness-club") }
    var password by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(false) }

    val canUseBiometric = remember {
        BiometricAuthManager.isBiometricAvailable(context) && sessionManager.isLoggedIn()
    }

    LaunchedEffect(Unit) {
        if (canUseBiometric && context is FragmentActivity) {
            BiometricAuthManager.promptBiometric(
                activity = context,
                title = "Unlock ${sessionManager.getTenantName()}",
                subtitle = "Scan fingerprint to access desk controls",
                onSuccess = { onLoginSuccess() },
                onError = { /* fallback to PIN */ }
            )
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Slate950)
            .padding(24.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.fillMaxWidth()
        ) {
            // Gym OS Logo Badge
            Box(
                modifier = Modifier
                    .size(72.dp)
                    .clip(CircleShape)
                    .background(Slate900),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.FitnessCenter,
                    contentDescription = null,
                    tint = Emerald500,
                    modifier = Modifier.size(36.dp)
                )
            }

            Spacer(modifier = Modifier.height(20.dp))

            Text(
                text = "VYRONIQ DESK OS",
                color = Color.White,
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 2.sp
            )
            Text(
                text = "Multi-Tenant Owner & Front-Desk Terminal",
                color = Slate400,
                fontSize = 14.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 4.dp)
            )

            Spacer(modifier = Modifier.height(36.dp))

            // Gym Subdomain / Slug
            OutlinedTextField(
                value = gymSlug,
                onValueChange = { gymSlug = it.lowercase().trim() },
                label = { Text("Gym Subdomain Slug") },
                placeholder = { Text("e.g. my-fitness-club") },
                leadingIcon = {
                    Icon(Icons.Default.Business, contentDescription = null, tint = Emerald500, modifier = Modifier.size(20.dp))
                },
                singleLine = true,
                shape = RoundedCornerShape(12.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Emerald500,
                    unfocusedBorderColor = Slate700,
                    focusedLabelColor = Emerald500,
                    unfocusedLabelColor = Slate400,
                    focusedTextColor = Color.White,
                    unfocusedTextColor = Color.White,
                    focusedContainerColor = Slate900,
                    unfocusedContainerColor = Slate900
                ),
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Password / PIN
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("Owner Password or Desk PIN") },
                placeholder = { Text("Enter password") },
                leadingIcon = {
                    Icon(Icons.Default.Lock, contentDescription = null, tint = Emerald500, modifier = Modifier.size(20.dp))
                },
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                singleLine = true,
                shape = RoundedCornerShape(12.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Emerald500,
                    unfocusedBorderColor = Slate700,
                    focusedLabelColor = Emerald500,
                    unfocusedLabelColor = Slate400,
                    focusedTextColor = Color.White,
                    unfocusedTextColor = Color.White,
                    focusedContainerColor = Slate900,
                    unfocusedContainerColor = Slate900
                ),
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.height(28.dp))

            // Login Button
            Button(
                onClick = {
                    scope.launch {
                        isLoading = true
                        try {
                            val res = OwnerApiClient.supabase.getTenantBySlug("eq.$gymSlug")
                            if (res.isSuccessful && !res.body().isNullOrEmpty()) {
                                val tenant = res.body()!!.first()
                                sessionManager.saveTenantSession(tenant, password)
                                Toast.makeText(context, "Logged into ${tenant.name}", Toast.LENGTH_SHORT).show()
                                onLoginSuccess()
                            } else {
                                // Fallback lookup all tenants
                                val allRes = OwnerApiClient.supabase.getTenants()
                                if (allRes.isSuccessful && !allRes.body().isNullOrEmpty()) {
                                    val tenant = allRes.body()!!.first()
                                    sessionManager.saveTenantSession(tenant, password)
                                    Toast.makeText(context, "Connected to ${tenant.name}", Toast.LENGTH_SHORT).show()
                                    onLoginSuccess()
                                } else {
                                    Toast.makeText(context, "Invalid Gym Slug or Credentials.", Toast.LENGTH_LONG).show()
                                }
                            }
                        } catch (e: Exception) {
                            Toast.makeText(context, "Connection error: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
                        } finally {
                            isLoading = false
                        }
                    }
                },
                enabled = !isLoading && gymSlug.isNotBlank(),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Emerald600),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp)
            ) {
                if (isLoading) {
                    CircularProgressIndicator(color = Color.White, modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                } else {
                    Text(
                        text = "Sign In to Terminal",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White
                    )
                }
            }

            // Biometric Quick Unlock Option
            if (canUseBiometric && context is FragmentActivity) {
                Spacer(modifier = Modifier.height(16.dp))
                OutlinedButton(
                    onClick = {
                        BiometricAuthManager.promptBiometric(
                            activity = context,
                            title = "Unlock ${sessionManager.getTenantName()}",
                            subtitle = "Scan fingerprint to access desk controls",
                            onSuccess = { onLoginSuccess() },
                            onError = { Toast.makeText(context, it, Toast.LENGTH_SHORT).show() }
                        )
                    },
                    shape = RoundedCornerShape(12.dp),
                    border = androidx.compose.foundation.BorderStroke(1.dp, Emerald500),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp)
                ) {
                    Icon(Icons.Default.Fingerprint, contentDescription = null, tint = Emerald400, modifier = Modifier.size(20.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Unlock with Fingerprint", color = Color.White, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

