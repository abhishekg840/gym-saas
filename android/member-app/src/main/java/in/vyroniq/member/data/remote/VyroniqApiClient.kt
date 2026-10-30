package in.vyroniq.member.data.remote

import in.vyroniq.member.BuildConfig
import in.vyroniq.member.data.model.AttendanceRecord
import in.vyroniq.member.data.model.InvoiceRecord
import in.vyroniq.member.data.model.MemberProfile
import in.vyroniq.member.data.model.PickupOrderRequest
import in.vyroniq.member.data.model.PickupOrderResponse
import in.vyroniq.member.data.model.StoreProduct
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Query
import java.util.concurrent.TimeUnit

interface SupabaseRestService {
    @GET("rest/v1/members")
    suspend fun getMemberByPhone(
        @Query("phone") phoneFilter: String,
        @Query("select") select: String = "*"
    ): Response<List<MemberProfile>>

    @GET("rest/v1/members")
    suspend fun getMemberById(
        @Query("id") idFilter: String,
        @Query("select") select: String = "*"
    ): Response<List<MemberProfile>>

    @GET("rest/v1/attendance_logs")
    suspend fun getAttendanceHistory(
        @Query("member_id") memberFilter: String,
        @Query("order") order: String = "check_in_time.desc",
        @Query("limit") limit: Int = 30
    ): Response<List<AttendanceRecord>>

    @GET("rest/v1/attendance_logs")
    suspend fun getActiveAttendanceSession(
        @Query("member_id") memberFilter: String,
        @Query("check_out_time") checkOutFilter: String = "is.null",
        @Query("order") order: String = "check_in_time.desc",
        @Query("limit") limit: Int = 1
    ): Response<List<AttendanceRecord>>

    @GET("rest/v1/fee_invoices")
    suspend fun getInvoices(
        @Query("member_id") memberFilter: String,
        @Query("order") order: String = "issued_at.desc",
        @Query("limit") limit: Int = 20
    ): Response<List<InvoiceRecord>>

    @GET("rest/v1/pos_inventory")
    suspend fun getStoreProducts(
        @Query("tenant_id") tenantFilter: String,
        @Query("in_stock") inStockFilter: String = "eq.true"
    ): Response<List<StoreProduct>>
}

interface BackendService {
    @POST("api/member/order-pickup")
    suspend fun createPickupOrder(
        @Body orderRequest: PickupOrderRequest
    ): Response<PickupOrderResponse>
}

object VyroniqApiClient {

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

    val supabase: SupabaseRestService = Retrofit.Builder()
        .baseUrl(BuildConfig.SUPABASE_URL + "/")
        .client(okHttpClient)
        .addConverterFactory(GsonConverterFactory.create())
        .build()
        .create(SupabaseRestService::class.java)

    val backend: BackendService = Retrofit.Builder()
        .baseUrl(BuildConfig.BASE_API_URL + "/")
        .client(okHttpClient)
        .addConverterFactory(GsonConverterFactory.create())
        .build()
        .create(BackendService::class.java)
}

