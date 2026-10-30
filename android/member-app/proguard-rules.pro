# Member App ProGuard Rules
-keepattributes *Annotation*
-keepclassmembers class * {
    @com.google.gson.annotations.SerializedName <fields>;
}
-keep class in.vyroniq.member.data.model.** { *; }
-dontwarn okhttp3.**
-dontwarn retrofit2.**

