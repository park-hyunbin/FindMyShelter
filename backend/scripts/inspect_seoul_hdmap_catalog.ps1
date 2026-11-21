param(
    [Parameter(Mandatory)]
    [string] $Output
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$base = 'https://map.ngii.go.kr'
$packagePage = "$base/ms/pblictn/preciseRoadMap.do"
$searchPage = "$base/ms/map/NlipMap.do"
$catalogue = Invoke-WebRequest -Uri $packagePage -UseBasicParsing -TimeoutSec 20
$packagePattern = '<input\s+[^>]*id="mapData110\d+"\s+value="(\d+)"[^>]*>\s*<i></i>(서울특별시_[가-힣]+구)</label>'
$packageIds = @{}
foreach ($match in [regex]::Matches($catalogue.Content, $packagePattern)) {
    $packageIds.Add($match.Groups[2].Value, $match.Groups[1].Value)
}

$null = Invoke-WebRequest -Uri $searchPage -UseBasicParsing -TimeoutSec 20 -SessionVariable searchSession
$headers = @{ Referer = $searchPage; 'X-Requested-With' = 'XMLHttpRequest' }
$term = [Uri]::EscapeDataString('서울')
$sort = [Uri]::EscapeDataString('2 desc, 1 asc')
$count = [int](Invoke-RestMethod -Uri "$base/hdmap/getPreRoadTotCnt.do?searchRoadName=$term&searchType=" -Headers $headers -WebSession $searchSession -TimeoutSec 20)
$results = @(
    for ($page = 1; $page -le [Math]::Ceiling($count / 10); $page++) {
        $response = Invoke-RestMethod -Uri "$base/hdmap/getPreRoadList.do?searchRoadName=$term&searchType=&sort=$sort&page=$page" -Headers $headers -WebSession $searchSession -TimeoutSec 20
        foreach ($result in $response) { $result }
    }
)
if ($results.Count -ne $count) {
    throw "The route search listed $count results and returned $($results.Count)."
}

$districts = [ordered]@{}
$otherResults = @(
    foreach ($route in ($results | Sort-Object hdm_yyyy -Descending)) {
        $name = $route.hdm_rd_nm
        $year = [int]$route.hdm_yyyy
        if ($name -notmatch '^서울특별시_[가-힣]+구$') {
            [ordered]@{ name = $name; year = $year; km_in_catalogue = $route.length }
            continue
        }
        if ($districts.Contains($name)) { continue }

        $query = [Uri]::EscapeDataString($name)
        $sections = Invoke-RestMethod -Uri "$base/hdmap/getPreSectorList.do?searchRoadName=$query&searchRoadKnd=&searchYear=$year" -Headers $headers -WebSession $searchSession -TimeoutSec 20
        if (!$sections.Count -or ($sections | Where-Object { $_.hdm_rd_nm -ne $name -or $_.hdm_yyyy -ne "$year" })) {
            throw "Missing or unexpected catalogue sections for $name ($year)."
        }
        $districts[$name] = [ordered]@{
            package_id = $packageIds[$name]
            year_in_catalogue = $year
            sections = @(
                foreach ($section in $sections) {
                    [ordered]@{
                        name = $section.hdm_sec_nm
                        section_id = $section.rd_id
                        km_in_catalogue = $section.length
                    }
                }
            )
        }
    }
)

if ($packageIds.Count -ne 25 -or $districts.Count -ne 25 -or ($districts.Keys | Where-Object { !$packageIds.ContainsKey($_) })) {
    throw 'The package and route listings do not agree on all 25 Seoul districts.'
}
$sectionCount = ($districts.Values | ForEach-Object { $_.sections.Count } | Measure-Object -Sum).Sum
[ordered]@{
    retrieved_at = [DateTimeOffset]::UtcNow.ToString('o')
    package_page = $packagePage
    search_page = $searchPage
    search_term = '서울'
    route_result_count = $count
    district_section_count = $sectionCount
    districts = $districts
    other_search_results = $otherResults
} | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $Output -Encoding utf8
