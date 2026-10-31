package `in`.vyroniq.owner.data.model

import com.google.gson.annotations.SerializedName

data class Tenant(
    @SerializedName("id") val id: String,
    @SerializedName("name") val name: String,
    @SerializedName("subdomain_slug") val subdomainSlug: String? = null,
    @SerializedName("tier_plan") val tierPlan: String = "PRO",
    @SerializedName("owner_name") val ownerName: String? = null,
    @SerializedName("owner_phone") val ownerPhone: String? = null,
    @SerializedName("logo_url") val logoUrl: String? = null,
    @SerializedName("is_suspended") val isSuspended: Boolean = false
)

data class OwnerDashboardStats(
    val liveFloorCount: Int = 0,
    val todayCollections: Double = 0.0,
    val mrrEstimate: Double = 0.0,
    val expiringSoonCount: Int = 0,
    val totalActiveMembers: Int = 0,
    val overdueCount: Int = 0
)

data class GymMember(
    @SerializedName("id") val id: String,
    @SerializedName("tenant_id") val tenantId: String,
    @SerializedName("full_name") val fullName: String,
    @SerializedName("phone") val phone: String,
    @SerializedName("email") val email: String? = null,
    @SerializedName("membership_plan") val membershipPlan: String? = "Monthly Pro",
    @SerializedName("membership_status") val membershipStatus: String = "active",
    @SerializedName("membership_end") val membershipEnd: String? = null,
    @SerializedName("pending_dues") val pendingDues: Double = 0.0,
    @SerializedName("photo_url") val photoUrl: String? = null,
    @SerializedName("rfid_tag") val rfidTag: String? = null,
    @SerializedName("created_at") val createdAt: String? = null
)

data class HardwareDevice(
    @SerializedName("id") val id: String,
    @SerializedName("device_name") val deviceName: String,
    @SerializedName("device_type") val deviceType: String,
    @SerializedName("status") val status: String = "online",
    @SerializedName("last_heartbeat") val lastHeartbeat: String? = null,
    @SerializedName("ip_address") val ipAddress: String? = null
)

data class CollectPaymentPayload(
    @SerializedName("member_id") val memberId: String,
    @SerializedName("tenant_id") val tenantId: String,
    @SerializedName("plan_name") val planName: String,
    @SerializedName("duration_days") val durationDays: Int,
    @SerializedName("total_fee") val totalFee: Double,
    @SerializedName("amount_paid") val amountPaid: Double,
    @SerializedName("discount") val discount: Double = 0.0,
    @SerializedName("payment_method") val paymentMethod: String = "cash",
    @SerializedName("notes") val notes: String? = null
)

data class CollectPaymentResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("invoice") val invoice: Any?,
    @SerializedName("message") val message: String?
)

data class DeleteMemberPayload(
    @SerializedName("member_id") val memberId: String,
    @SerializedName("tenant_id") val tenantId: String
)

data class DeleteMemberResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("message") val message: String?
)

