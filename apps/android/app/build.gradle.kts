plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "cc.planrla.android"
    compileSdk = 34

    defaultConfig {
        applicationId = "cc.planrla.android"
        minSdk = 26
        targetSdk = 34
        versionCode = 4
        versionName = "0.3.0"
        buildConfigField("String", "DEFAULT_SERVER", "\"http://192.168.0.13:3002\"")
        buildConfigField("String", "UPDATE_REPO", "\"fucheng830/planrla-release\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.15"
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.09.02")
    implementation(composeBom)

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.navigation:navigation-compose:2.8.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.6")
    implementation("androidx.lifecycle:lifecycle-process:2.8.6")
    implementation("androidx.datastore:datastore-preferences:1.1.1")

    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")
    implementation("com.jakewharton.retrofit:retrofit2-kotlinx-serialization-converter:1.0.0")

    implementation("com.mikepenz:multiplatform-markdown-renderer-m3:0.22.0")
    implementation("com.mikepenz:multiplatform-markdown-renderer-android:0.22.0")
    // coil2 image loader — without it the markdown renderer's default NoOp
    // ImageTransformer silently drops every ![](...) network image.
    // (the coil3 variant of 0.22.0 pins an unresolvable coil 3.0.0-SNAPSHOT, so coil2 it is)
    implementation("com.mikepenz:multiplatform-markdown-renderer-coil2:0.22.0")
    implementation("org.commonmark:commonmark:0.21.0")

    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    implementation("androidx.appcompat:appcompat:1.7.0")

    debugImplementation("androidx.compose.ui:ui-tooling")
}
