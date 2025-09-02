# packet

## Example 1

**SebastianJS (SVG):**

<svg id="graph" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewbox="0 0 1026 344" style="max-width: 1026px;" role="graphics-document document" aria-roledescription="packet" viewBox="-3 11 1027 322"><style>#graph{font-family:"trebuchet ms",verdana,arial,sans-serif;font-size:16px;fill:#333;}@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}@keyframes dash{to{stroke-dashoffset:0;}}#graph .edge-animation-slow{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 50s linear infinite;stroke-linecap:round;}#graph .edge-animation-fast{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 20s linear infinite;stroke-linecap:round;}#graph .error-icon{fill:#552222;}#graph .error-text{fill:#552222;stroke:#552222;}#graph .edge-thickness-normal{stroke-width:1px;}#graph .edge-thickness-thick{stroke-width:3.5px;}#graph .edge-pattern-solid{stroke-dasharray:0;}#graph .edge-thickness-invisible{stroke-width:0;fill:none;}#graph .edge-pattern-dashed{stroke-dasharray:3;}#graph .edge-pattern-dotted{stroke-dasharray:2;}#graph .marker{fill:#333333;stroke:#333333;}#graph .marker.cross{stroke:#333333;}#graph svg{font-family:"trebuchet ms",verdana,arial,sans-serif;font-size:16px;}#graph p{margin:0;}#graph .packetByte{font-size:10px;}#graph .packetByte.start{fill:black;}#graph .packetByte.end{fill:black;}#graph .packetLabel{fill:black;font-size:12px;}#graph .packetTitle{fill:black;font-size:14px;}#graph .packetBlock{stroke:black;stroke-width:1;fill:#efefef;}#graph :root{--mermaid-font-family:"trebuchet ms",verdana,arial,sans-serif;}</style><g/><g><rect x="1" y="15" width="507" height="32" class="packetBlock"/><text x="254.5" y="31" class="packetLabel" dominant-baseline="middle" text-anchor="middle">Source Port</text><text x="1" y="13" class="packetByte start" dominant-baseline="auto" text-anchor="start">0</text><text x="508" y="13" class="packetByte end" dominant-baseline="auto" text-anchor="end">15</text><rect x="513" y="15" width="507" height="32" class="packetBlock"/><text x="766.5" y="31" class="packetLabel" dominant-baseline="middle" text-anchor="middle">Destination Port</text><text x="513" y="13" class="packetByte start" dominant-baseline="auto" text-anchor="start">16</text><text x="1020" y="13" class="packetByte end" dominant-baseline="auto" text-anchor="end">31</text></g><g><rect x="1" y="62" width="1019" height="32" class="packetBlock"/><text x="510.5" y="78" class="packetLabel" dominant-baseline="middle" text-anchor="middle">Sequence Number</text><text x="1" y="60" class="packetByte start" dominant-baseline="auto" text-anchor="start">32</text><text x="1020" y="60" class="packetByte end" dominant-baseline="auto" text-anchor="end">63</text></g><g><rect x="1" y="109" width="1019" height="32" class="packetBlock"/><text x="510.5" y="125" class="packetLabel" dominant-baseline="middle" text-anchor="middle">Acknowledgment Number</text><text x="1" y="107" class="packetByte start" dominant-baseline="auto" text-anchor="start">64</text><text x="1020" y="107" class="packetByte end" dominant-baseline="auto" text-anchor="end">95</text></g><g><rect x="1" y="156" width="123" height="32" class="packetBlock"/><text x="62.5" y="172" class="packetLabel" dominant-baseline="middle" text-anchor="middle">Data Offset</text><text x="1" y="154" class="packetByte start" dominant-baseline="auto" text-anchor="start">96</text><text x="124" y="154" class="packetByte end" dominant-baseline="auto" text-anchor="end">99</text><rect x="129" y="156" width="187" height="32" class="packetBlock"/><text x="222.5" y="172" class="packetLabel" dominant-baseline="middle" text-anchor="middle">Reserved</text><text x="129" y="154" class="packetByte start" dominant-baseline="auto" text-anchor="start">100</text><text x="316" y="154" class="packetByte end" dominant-baseline="auto" text-anchor="end">105</text><rect x="321" y="156" width="27" height="32" class="packetBlock"/><text x="334.5" y="172" class="packetLabel" dominant-baseline="middle" text-anchor="middle">URG</text><text x="334.5" y="154" class="packetByte start" dominant-baseline="auto" text-anchor="middle">106</text><rect x="353" y="156" width="27" height="32" class="packetBlock"/><text x="366.5" y="172" class="packetLabel" dominant-baseline="middle" text-anchor="middle">ACK</text><text x="366.5" y="154" class="packetByte start" dominant-baseline="auto" text-anchor="middle">107</text><rect x="385" y="156" width="27" height="32" class="packetBlock"/><text x="398.5" y="172" class="packetLabel" dominant-baseline="middle" text-anchor="middle">PSH</text><text x="398.5" y="154" class="packetByte start" dominant-baseline="auto" text-anchor="middle">108</text><rect x="417" y="156" width="27" height="32" class="packetBlock"/><text x="430.5" y="172" class="packetLabel" dominant-baseline="middle" text-anchor="middle">RST</text><text x="430.5" y="154" class="packetByte start" dominant-baseline="auto" text-anchor="middle">109</text><rect x="449" y="156" width="27" height="32" class="packetBlock"/><text x="462.5" y="172" class="packetLabel" dominant-baseline="middle" text-anchor="middle">SYN</text><text x="462.5" y="154" class="packetByte start" dominant-baseline="auto" text-anchor="middle">110</text><rect x="481" y="156" width="27" height="32" class="packetBlock"/><text x="494.5" y="172" class="packetLabel" dominant-baseline="middle" text-anchor="middle">FIN</text><text x="494.5" y="154" class="packetByte start" dominant-baseline="auto" text-anchor="middle">111</text><rect x="513" y="156" width="507" height="32" class="packetBlock"/><text x="766.5" y="172" class="packetLabel" dominant-baseline="middle" text-anchor="middle">Window</text><text x="513" y="154" class="packetByte start" dominant-baseline="auto" text-anchor="start">112</text><text x="1020" y="154" class="packetByte end" dominant-baseline="auto" text-anchor="end">127</text></g><g><rect x="1" y="203" width="507" height="32" class="packetBlock"/><text x="254.5" y="219" class="packetLabel" dominant-baseline="middle" text-anchor="middle">Checksum</text><text x="1" y="201" class="packetByte start" dominant-baseline="auto" text-anchor="start">128</text><text x="508" y="201" class="packetByte end" dominant-baseline="auto" text-anchor="end">143</text><rect x="513" y="203" width="507" height="32" class="packetBlock"/><text x="766.5" y="219" class="packetLabel" dominant-baseline="middle" text-anchor="middle">Urgent Pointer</text><text x="513" y="201" class="packetByte start" dominant-baseline="auto" text-anchor="start">144</text><text x="1020" y="201" class="packetByte end" dominant-baseline="auto" text-anchor="end">159</text></g><g><rect x="1" y="250" width="1019" height="32" class="packetBlock"/><text x="510.5" y="266" class="packetLabel" dominant-baseline="middle" text-anchor="middle">(Options and Padding)</text><text x="1" y="248" class="packetByte start" dominant-baseline="auto" text-anchor="start">160</text><text x="1020" y="248" class="packetByte end" dominant-baseline="auto" text-anchor="end">191</text></g><g><rect x="1" y="297" width="1019" height="32" class="packetBlock"/><text x="510.5" y="313" class="packetLabel" dominant-baseline="middle" text-anchor="middle">data</text><text x="1" y="295" class="packetByte start" dominant-baseline="auto" text-anchor="start">192</text><text x="1020" y="295" class="packetByte end" dominant-baseline="auto" text-anchor="end">223</text></g><text x="513" y="320.5" dominant-baseline="middle" text-anchor="middle" class="packetTitle"/></svg>

**Mermaid Code (Browser Rendered):**

```mermaid
packet
        0-15: "Source Port"
        16-31: "Destination Port"
        32-63: "Sequence Number"
        64-95: "Acknowledgment Number"
        96-99: "Data Offset"
        100-105: "Reserved"
        106: "URG"
        107: "ACK"
        108: "PSH"
        109: "RST"
        110: "SYN"
        111: "FIN"
        112-127: "Window"
        128-143: "Checksum"
        144-159: "Urgent Pointer"
        160-191: "(Options and Padding)"
        192-223: "data"
```

## Example 2

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
      config:
        packet:
          showBits: false
      ---
      packet
        0-15: "Source Port"
        16-31: "Destination Port"
        32-63: "Sequence Number"
        64-95: "Acknowledgment Number"
        96-99: "Data Offset"
        100-105: "Reserved"
        106: "URG"
        107: "ACK"
        108: "PSH"
        109: "RST"
        110: "SYN"
        111: "FIN"
        112-127: "Window"
        128-143: "Checksum"
        144-159: "Urgent Pointer"
        160-191: "(Options and Padding)"
        192-223: "data"
```

## Example 3

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
      config:
        theme: forest
      ---
      packet
        title Forest theme
        0-15: "Source Port"
        16-31: "Destination Port"
        32-63: "Sequence Number"
        64-95: "Acknowledgment Number"
        96-99: "Data Offset"
        100-105: "Reserved"
        106: "URG"
        107: "ACK"
        108: "PSH"
        109: "RST"
        110: "SYN"
        111: "FIN"
        112-127: "Window"
        128-143: "Checksum"
        144-159: "Urgent Pointer"
        160-191: "(Options and Padding)"
        192-223: "data"
```

## Example 4

**SebastianJS (SVG):**

> Render failed: Error: Diagrams beginning with --- are not valid. If you were trying to use a YAML front-matter, please ensure that you've correctly opened and closed the YAML front-matter with un-indented `---` blocks

**Mermaid Code (Browser Rendered):**

```mermaid
---
      config:
        theme: dark
      ---
      packet
        title Dark theme
        0-15: "Source Port"
        16-31: "Destination Port"
        32-63: "Sequence Number"
        64-95: "Acknowledgment Number"
        96-99: "Data Offset"
        100-105: "Reserved"
        106: "URG"
        107: "ACK"
        108: "PSH"
        109: "RST"
        110: "SYN"
        111: "FIN"
        112-127: "Window"
        128-143: "Checksum"
        144-159: "Urgent Pointer"
        160-191: "(Options and Padding)"
        192-223: "data"
```

