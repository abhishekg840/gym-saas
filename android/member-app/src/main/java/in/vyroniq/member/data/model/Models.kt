package `in`.vyroniq.member.data.model

import com.google.gson.annotations.SerializedName

data class MemberProfile(
    @SerializedName("id") val id: String,
    @SerializedName("tenant_id") val tenantId: String,
    @SerializedName("full_name") val fullName: String,
    @SerializedName("phone") val phone: String,
    @SerializedName("email") val email: String? = null,
    @SerializedName("membership_plan") val membershipPlan: String? = null,
    @SerializedName("membership_status") val membershipStatus: String = "active",
    @SerializedName("membership_end") val membershipEnd: String? = null,
    @SerializedName("pending_dues") val pendingDues: Double = 0.0,
    @SerializedName("avatar_url") val avatarUrl: String? = null,
    @SerializedName("gym_name") val gymName: String? = null
)

data class PassMintResponse(
    @SerializedName("token") val token: String,
    @SerializedName("expires_at") val expiresAt: Long,
    @SerializedName("member_id") val memberId: String,
    @SerializedName("tenant_id") val tenantId: String
)

data class AttendanceRecord(
    @SerializedName("id") val id: String,
    @SerializedName("member_id") val memberId: String,
    @SerializedName("check_in_time") val checkInTime: String,
    @SerializedName("check_out_time") val checkOutTime: String? = null,
    @SerializedName("method") val method: String? = "qr",
    @SerializedName("auto_checked_out") val autoCheckedOut: Boolean = false
)

data class ActiveWorkoutSession(
    val checkInTimeMs: Long,
    val isCheckedIn: Boolean
)

data class InvoiceRecord(
    @SerializedName("id") val id: String,
    @SerializedName("invoice_number") val invoiceNumber: String,
    @SerializedName("amount_paid") val amountPaid: Double,
    @SerializedName("plan_name") val planName: String,
    @SerializedName("payment_method") val paymentMethod: String,
    @SerializedName("issued_at") val issuedAt: String,
    @SerializedName("pdf_url") val pdfUrl: String? = null
)

data class StoreProduct(
    @SerializedName("id") val id: String,
    @SerializedName("name") val name: String,
    @SerializedName("category") val category: String,
    @SerializedName("price") val price: Double,
    @SerializedName("image_url") val imageUrl: String? = null,
    @SerializedName("in_stock") val inStock: Boolean = true,
    @SerializedName("description") val description: String? = null
)

data class PickupOrderRequest(
    @SerializedName("member_id") val memberId: String,
    @SerializedName("tenant_id") val tenantId: String,
    @SerializedName("product_id") val productId: String,
    @SerializedName("quantity") val quantity: Int = 1,
    @SerializedName("total_amount") val totalAmount: Double
)

data class PickupOrderResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("order_id") val orderId: String?,
    @SerializedName("pickup_code") val pickupCode: String?
)

