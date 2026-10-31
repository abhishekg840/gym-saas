package `in`.vyroniq.member.ui.screens

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
import androidx.compose.material.icons.filled.FitnessCenter
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import `in`.vyroniq.member.VyroniqMemberApp
import `in`.vyroniq.member.data.remote.VyroniqApiClient
import `in`.vyroniq.member.ui.theme.Emerald500
import `in`.vyroniq.member.ui.theme.Emerald600
import `in`.vyroniq.member.ui.theme.Slate400
import `in`.vyroniq.member.ui.theme.Slate700
import `in`.vyroniq.member.ui.theme.Slate800
import `in`.vyroniq.member.ui.theme.Slate900
import `in`.vyroniq.member.ui.theme.Slate950
import kotlinx.coroutines.launch

@Composable
fun LoginScreen(
    onLoginSuccess: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var phone by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(false) }

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
                    contentDescription = "Gym Logo",
                    tint = Emerald500,
                    modifier = Modifier.size(36.dp)
                )
            }

            Spacer(modifier = Modifier.height(20.dp))

            Text(
                text = "VYRONIQ MEMBER",
                color = Color.White,
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 2.sp
            )
            Text(
                text = "Dynamic Gate Pass & Member Companion",
                color = Slate400,
                fontSize = 14.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 4.dp)
            )

            Spacer(modifier = Modifier.height(36.dp))

            // Phone Field
            OutlinedTextField(
                value = phone,
                onValueChange = { if (it.length <= 10) phone = it.filter { char -> char.isDigit() } },
                label = { Text("Registered Mobile Number") },
                placeholder = { Text("e.g. 9876543210") },
                leadingIcon = {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(start = 12.dp, end = 6.dp)
                    ) {
                        Icon(Icons.Default.Phone, contentDescription = null, tint = Emerald500, modifier = Modifier.size(20.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("+91", color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                    }
                },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
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

            // Password Field
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("Access PIN or Password") },
                placeholder = { Text("Enter your password") },
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
                    if (phone.length < 10) {
                        Toast.makeText(context, "Enter a valid 10-digit mobile number", Toast.LENGTH_SHORT).show()
                        return@Button
                    }
                    scope.launch {
                        isLoading = true
                        try {
                            val formattedPhone = if (phone.startsWith("+91")) phone else "+91$phone"
                            val cleanNumber = phone.takeLast(10)

                            // Query Supabase for member matching phone
                            val response = VyroniqApiClient.supabase.getMemberByPhone(
                                phoneFilter = "ilike.%$cleanNumber%"
                            )

                            if (response.isSuccessful && !response.body().isNullOrEmpty()) {
                                val member = response.body()!!.first()
                                VyroniqMemberApp.instance.sessionManager.saveSession(
                                    token = "jwt_${member.id}_${System.currentTimeMillis()}",
                                    profile = member
                                )
                                Toast.makeText(context, "Welcome back, ${member.fullName}!", Toast.LENGTH_SHORT).show()
                                onLoginSuccess()
                            } else {
                                Toast.makeText(context, "Member record not found for this number.", Toast.LENGTH_LONG).show()
                            }
                        } catch (e: Exception) {
                            Toast.makeText(context, "Connection error: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
                        } finally {
                            isLoading = false
                        }
                    }
                },
                enabled = !isLoading && phone.length >= 10,
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Emerald600,
                    disabledContainerColor = Slate800
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp)
            ) {
                if (isLoading) {
                    CircularProgressIndicator(color = Color.White, modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                } else {
                    Text(
                        text = "Sign In & Get Gate Pass",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White
                    )
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            Text(
                text = "Persistent Session: Stays logged in securely on this phone.",
                color = Slate400,
                fontSize = 12.sp,
                textAlign = TextAlign.Center
            )
        }
    }
}

