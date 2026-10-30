package in.vyroniq.owner.data.remote

import in.vyroniq.owner.BuildConfig
import in.vyroniq.owner.data.model.CollectPaymentPayload
import in.vyroniq.owner.data.model.CollectPaymentResponse
import in.vyroniq.owner.data.model.DeleteMemberPayload
import in.vyroniq.owner.data.model.DeleteMemberResponse
import in.vyroniq.owner.data.model.GymMember
import in.vyroniq.owner.data.model.HardwareDevice
import in.vyroniq.owner.data.model.Tenant
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Headers
import retrofit2.http.POST
import retrofit2.http.Query
import java.util.concurrent.TimeUnit

interface OwnerSupabaseService {
    @GET("rest/v1/tenants")
    suspend fun getTenants(
        @Query("select") select: String = "*"
    ): Response<List<Tenant>>

    @GET("rest/v1/tenants")
    suspend fun getTenantBySlug(
        @Query("subdomain_slug") slugFilter: String,
        @Query("select") select: String = "*"
    ): Response<List<Tenant>>

    @GET("rest/v1/members")
    suspend fun getMembers(
        @Query("tenant_id") tenantFilter: String,
        @Query("order") order: String = "created_at.desc",
        @Query("select") select: String = "*"
    ): Response<List<GymMember>>

    @GET("rest/v1/attendance_logs")
    suspend fun getLiveFloorAttendance(
        @Query("tenant_id") tenantFilter: String,
        @Query("check_out_time") checkOutFilter: String = "is.null"
    ): Response<List<Any>>

    @GET("rest/v1/fee_invoices")
    suspend fun getFeeInvoices(
        @Query("tenant_id") tenantFilter: String,
        @Query("order") order: String = "issued_at.desc",
        @Query("limit") limit: Int = 100
    ): Response<List<Any>>

    @GET("rest/v1/hardware_devices")
    suspend fun getHardwareDevices(
        @Query("tenant_id") tenantFilter: String
    ): Response<List<HardwareDevice>>
}

interface OwnerBackendService {
    @POST("api/admin/payments/collect")
    suspend fun collectPayment(
        @Body payload: CollectPaymentPayload
    ): Response<CollectPaymentResponse>

    @POST("api/member/delete")
    suspend fun deleteMember(
        @Body payload: DeleteMemberPayload
    ): Response<DeleteMemberResponse>

    @POST("api/hardware/poll")
    suspend fun triggerGatePulse(
        @Body payload: Map<String, String>
    ): Response<Map<String, Any>>
}

object OwnerApiClient {

    private val okHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .addInterceptor { chain ->
            val request = chain.request().newBuilder()
                .addHeader("apikey", BuildConfig.SUPABASE_ANON_KEY)
                .addHeader("Authorization", "Bearer ${BuildConfig.SUPABASE_ANON_KEY}")
                .addHeader("Content-Type", "application/json")
                .build()
            chain.proceed(request)
        }
        .addInterceptor(HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        })
        .build()

    val supabase: OwnerSupabaseService = Retrofit.Builder()
        .baseUrl(BuildConfig.SUPABASE_URL + "/")
        .client(okHttpClient)
        .addConverterFactory(GsonConverterFactory.create())
        .build()
        .create(OwnerSupabaseService::class.java)

    val backend: OwnerBackendService = Retrofit.Builder()
        .baseUrl(BuildConfig.BASE_API_URL + "/")
        .client(okHttpClient)
        .addConverterFactory(GsonConverterFactory.create())
        .build()
        .create(OwnerBackendService::class.java)
}

