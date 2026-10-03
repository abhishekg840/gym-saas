$url = 'https://encffdlmbzrsfwbytrbn.supabase.co'
$key = (Get-Content .env.local | Select-String 'ANON_KEY=').ToString().Split('=',2)[1].Trim()

$tests = @(
  @{ name = 'fn_member_verify_password'; body = '{"p_identifier":"6394550174","p_password":"1234"}' },
  @{ name = 'fn_staff_verify_password';  body = '{"p_identifier":"6394550174","p_password":"1234"}' },
  @{ name = 'fn_staff_verify_password';  body = '{"p_identifier":"6394550174","p_password":"wrong-password-probe"}' },
  @{ name = 'fn_staff_verify_password';  body = '{"p_identifier":"0000000000","p_password":"whatever"}' },
  @{ name = 'fn_staff_verify_password';  body = '{"p_identifier":"admin1234-identifier-probe","p_password":"x"}' }
)

foreach ($t in $tests) {
  Write-Output "=== $($t.name) $($t.body) ==="
  $tmp = [System.IO.Path]::GetTempFileName()
  [System.IO.File]::WriteAllText($tmp, $t.body)
  curl.exe -s -X POST "$url/rest/v1/rpc/$($t.name)" `
    -H "apikey: $key" -H "Authorization: Bearer $key" `
    -H "Content-Type: application/json" `
    --data-binary "@$tmp" -w "`nHTTP:%{http_code}`n"
  Remove-Item $tmp -Force
}

