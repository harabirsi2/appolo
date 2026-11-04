auto_attack v4 — LAN ARP MITM toolkit (GUI + engine)
=====================================================

WHAT IT IS
  Two programs in one folder:
    auto_attack_gui.exe   the control panel (start this one)
    auto_attack.exe       the engine — the GUI launches it automatically
                          in the background and drives it over pipes
                          (you never need to open the console yourself)

  The GUI shows live targets, per-device DNS/SNI/HTTP activity, attack
  modes, DNS rules, app blocking, and captive-portal messaging — with a
  status bar that counts up while an attack runs, so you can always see
  it working.

REQUIREMENTS
  - Windows 10/11 x64, run as Administrator (both exes self-prompt via UAC)
  - Npcap runtime installed: https://npcap.com/#download
    (check "WinPcap API-compatible mode" during install)
  - both exes in the SAME folder (GUI finds the engine next to itself)
  - no other DLLs needed — both exes are statically linked
  - engine writes its outputs under an atk\ folder next to the exes


HOW TO START (GUI)
  1. double-click auto_attack_gui.exe  → accept the UAC prompt
  2. pick your network adapter in the header dropdown
     (only adapters with a gateway are listed; the one you used last
      time is remembered in atk\gui.ini; changing it asks to restart
      the engine)
  3. the network is scanned automatically ~1.5 s after launch —
     press "Scan Network" any time to rescan, or "How To Use" for the
     built-in quick guide
  4. tick the checkbox next to your target device(s)
     (hostnames appear after the scan and keep filling in passively;
      "Resolve Names" also probes actively)
  5. pick an attack mode, press START ATTACK
     (if nothing is ticked, the GUI offers to select all devices)
  6. watch the status bar: seen / dns / kills / sent counters climb
  7. STOP & REPAIR (or the header STOP) restores ARP; RESTORE ARP
     forces the repair without stopping the engine


GUI TABS
  Setup       Scan / Quick Start / Resolve Names / Select all/none /
              toggle IP forwarding / How To Use (built-in guide);
              device list with checkboxes; mode dropdown;
              START / STOP & REPAIR
  Tracking    per-host activity table (DNS / SNI / HTTP counters + age +
              event count), Top 10, Watch Selected (streams a host's recent
              events into the log), Show Track Log, List Track Logs, plus a
              live per-device timeline: pick a device in the dropdown to
              stream its recent network events, tick "Record PCAP" to save
              that device's raw packets, then "Save Timeline" or
              "Open Captures" (see DETAILED TRAFFIC VIEW below)
  Control     DNS rules: block domain / redirect domain→IP / unblock,
              rule list, Save Rules / Load Rules, Kick (SYN flood) /
              Unkick
  Message     captive-portal notice: type a message, choose target
              (* = everyone, or one IP), Send / Stop. Needs a running
              attack; if none is active the GUI offers to start one.
              The notice is served on port 80 of this machine and shows
              on the victim's next DNS lookup / portal probe.
  Apps        detected apps per device; Block App / Unblock App kill the
              app for that device (DNS block + live TCP RST)
  (bottom)    full engine log — Clear / Copy / Save


ATTACK MODES
  1  Intercept   full MITM, both directions poisoned, victim keeps net
  2  Tap         one-way, gateway untouched
  3  Block       cut the selected device's internet
  4  Record      MITM + credential capture (plaintext HTTP POST bodies
              are logged to atk\\tracks\\track_<ip>.log)
  5  Strip       reserved - currently behaves exactly like Intercept
  6  DoS         SYN flood against the selected device(s)
  Quick Start = scan + select all + mode 1 + arm, one click

  DNS rules answer both A and AAAA queries: blocked/redirected domains get
  a real A answer plus an empty AAAA answer, so clients can't slip past the
  rule over IPv6.


DETAILED TRAFFIC VIEW (per device)
  The Tracking tab has a live timeline for one device at a time, so you can
  see what a target is actually doing on the network, packet by packet:
    - choose the device in the dropdown (it also helps to focus a device
      first: double-click its row, or press "Focus Device")
    - a live traffic summary sits above the timeline: bytes up/down,
      packet counts, the protocol mix (DNS / TLS / QUIC / HTTP / mDNS /
      SSDP / DHCP ...), and the device's busiest peers
    - the timeline shows a time-stamped line per observed event, e.g.
        [12:04:31] mDNS   Smart-TV._googlecast._tcp.local
        [12:04:35] SSDP-SEARCH M-SEARCH * HTTP/1.1
        [12:04:41] DNS    www.example.com
        [12:04:41] HTTP   www.example.com GET /index.html
    - event kinds: DNS, mDNS, LLMNR, SSDP / SSDP-SEARCH, DHCP, SNI (TLS
      handshake hostnames) and HTTP requests. Most devices use encrypted
      DNS/QUIC for the internet, so the local-discovery rows (mDNS/LLMNR/
      SSDP/DHCP) are usually what fills the timeline.
    - "Record PCAP" saves that device's raw packets to
      atk\captures\<ip>.pcap (openable in Wireshark); it grows until you
      untick the box or the device hits 32 MB
    - "Save Timeline" writes the visible text to a file; "Open Captures"
      opens the captures folder
  The same data is available without the GUI:
    detail <ip> [n]      print a device's recent timeline (default 20 rows)
    stats [ip]           traffic breakdown: bytes up/down, packet counts,
                         protocol mix and the busiest peers
    _focus <ip|none>     focus a device (drives the GUI timeline/summary)
    pcap on | pcap off   start/stop per-device capture


DEVICE NAMES
  Names are learned two ways and the best one wins:
    passive (always on)  mDNS/LLMNR/DNS answers (PTR, A, SRV), NetBIOS
                         node status, DHCP option 12/81 (mapped by MAC),
                         WS-Discovery "Computer" names
    active (scan/Resolve Names)
                         NetBIOS, LLMNR, mDNS, reverse DNS, plus SSDP/UPnP
                         discovery and each device's <friendlyName>
  A MAC-vendor name (Apple, Samsung, ...) is the fallback when a device
  advertises no name at all. Phones that randomise their MAC and publish
  nothing may stay as the vendor name.


LIVE PROOF IT'S WORKING
  status bar (refreshed ~every 800 ms):
    [ ATTACKING ] | 1 / 5 targets | mode: intercept | fwd: on |
    seen: 4310  dns: 96  kills: 12  sent: 887
  - "seen" climbing  = packets physically captured from your network
  - "dns" climbing   = DNS answers you redirected/blocked
  - "kills" climbing = connections you tore down (app block / DoS)
  - Tracking tab     = per-device DNS/SNI/HTTP tables filling up live
  - keyboard shortcuts: F5 = Scan, Enter = Start, Esc = Stop


FILES WRITTEN (under atk\)
  atk\gui.ini                GUI settings (last adapter used)
  atk\rules.txt              saved DNS rules (tab separated)
  atk\tracks\track_<ip>.log  per-device event log (DNS/SNI/HTTP lines)
  atk\captures\<ip>.pcap     per-device raw packet capture (Record PCAP)
  atk\session_*.json         summary written when the engine exits
  (v4 no longer writes mitm_capture.pcap / credentials.txt —
   Record mode tracks activity through the same tables)


CONSOLE (optional — auto_attack.exe can also be run by hand)
  1 scan | t <spec> | m <1-6> | g start | x stop | i status | h help
  extras: users, top, tracks, watch <ip>, showtrack <ip> <n>,
           detail <ip> [n], stats [ip], _focus <ip|none>, pcap [on|off],
          block <dom> [ip|*], redirect <dom> <ip> [ip|*], unblock <dom>,
          rules, save, load, blockapp <app> [ip|*], unblockapp <app>,
          apps, appsigs, msgall <text>, msg <ip> <text>, msgstop,
          msgtest, kick <ip>, unkick, restore, names, hosts
  run with --adapter=N or --adapter-guid={GUID} to skip the adapter prompt
  (the GUI always passes the GUID so a NIC appearing/disappearing cannot
   make it pick the wrong adapter)


SAFE USE
  STOP / RESTORE / quit all repair ARP caches before exit; if the process
  is killed hard, caches self-heal in ~30-60 s anyway. Forwarding is
  enabled per-interface (netsh) only while an attack runs, and the exact
  state found at startup is restored on stop/quit. No registry values are
  changed, so a crash can never leave this machine routing after a reboot.

  Use only on networks you own or have permission to test.


TROUBLESHOOTING
  no devices found      → wrong adapter? pick the one whose IP matches
                          your LAN in the header dropdown, rescan
  no device names       → names fill in passively while the engine runs;
                          press Resolve Names for active mDNS/NetBIOS/SSDP
                          probes. Some phones publish nothing, so the MAC
                          vendor (Apple, Samsung, ...) stays as fallback.
  counters don't move   → attack not started? status bar must say
                          [ ATTACKING ]; also check fwd: on for modes 1/4/5
  portal message fails  → a message needs a running attack. The log names
                          the program holding port 80 if the portal cannot
                          bind. HTTPS/DoH/IPv6-only DNS can bypass the
                          notice; use msgtest to prove the portal answers.
  wpcap.dll not found   → install the Npcap runtime
  traffic dies          → forwarding could not be enabled; the engine
                          refuses to start an intercept in that case.
                          run as administrator and check the adapter


REBUILD (optional - the exes are already built and self-contained)
  needs: MSYS2 MinGW g++ at C:\msys64\ucrt64 and the Npcap SDK
  download the SDK from https://npcap.com/#download and extract it here as
  Npcap\Include and Npcap\Lib\x64, then double-click build.bat
  builds both exes, stages dist\ (exes + README + src\)

  files:
    src\auto_attack.cpp     engine
    src\gui_main.cpp        GUI
    src\auto_attack.rc/.manifest   engine UAC resource
    src\gui.rc/.manifest           GUI UAC resource (comctl32 v6 + UAC)
    build.bat               MSYS2 MinGW build + dist staging
