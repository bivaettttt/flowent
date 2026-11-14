"""Presentation geometry for the corporate expense BPMN fixture."""

# Tasks use the same size as the other fixtures. Gateways use their full
# diamond bounds so BPMN renderers can dock flows at the four vertices.
BOUNDS = {
    "Start": (12, 262, 36, 36),
    "Entry": (76, 258, 44, 44),
    "Route": (153, 258, 44, 44),
    "Solo": (292, 92, 145, 66),
    "Split": (236, 258, 44, 44),
    "Lead": (320, 195, 145, 66),
    "Second": (320, 318, 145, 66),
    "Join": (505, 258, 44, 44),
    "SoloDecision": (658, 103, 44, 44),
    "LeadDecision": (658, 258, 44, 44),
    "SecondDecision": (770, 258, 44, 44),
    "Revision": (611, 12, 145, 66),
    "Wait": (882, 262, 36, 36),
    "Service": (951, 247, 145, 66),
    "Fulfil": (1127, 247, 145, 66),
    "End": (1305, 262, 36, 36),
    "Reject": (882, 433, 36, 36),
}

# Bounds supplied to BPMNLabel determine the center and starting y of each
# external label. The branch arrows leave vertical space for these labels.
LABELS = {
    "Entry": (58, 308, 80, 32),
    "Route": (135, 308, 80, 32),
    "Split": (212, 365, 92, 32),
    "Join": (484, 365, 86, 32),
    "SoloDecision": (627, 153, 106, 32),
    "LeadDecision": (619, 225, 122, 32),
    "SecondDecision": (736, 307, 112, 32),
    "Wait": (856, 308, 88, 32),
    "End": (1269, 308, 108, 32),
    "Reject": (853, 490, 94, 32),
}

# Upper lane returns revisions to Entry. Lower lanes run to the rejection
# event. Only the paths between the three decision outcomes share crossings.
WAYPOINTS = {
    "begin": [(48, 280), (76, 280)],
    "entryRoute": [(120, 280), (153, 280)],
    "complex": [(197, 280), (236, 280)],
    "simple": [(175, 258), (175, 125), (292, 125)],
    "splitLead": [(258, 258), (258, 228), (320, 228)],
    "splitSecond": [(258, 302), (258, 351), (320, 351)],
    "leadJoin": [(465, 228), (527, 228), (527, 258)],
    "secondJoin": [(465, 351), (527, 351), (527, 302)],
    "joined": [(549, 280), (658, 280)],
    "soloResult": [(437, 125), (658, 125)],
    "soloOk": [(702, 125), (853, 125), (853, 201), (900, 201), (900, 262)],
    "soloRev": [(680, 103), (680, 92), (649, 92), (649, 78)],
    "soloNo": [(669, 136), (669, 144), (605, 144), (605, 476), (900, 476), (900, 469)],
    "leadOk": [(702, 280), (770, 280)],
    "leadRev": [(691, 269), (747, 269), (747, 92), (713, 92), (713, 78)],
    "leadNo": [(680, 302), (680, 451), (882, 451)],
    "extraOk": [(814, 280), (882, 280)],
    "extraRev": [(792, 258), (792, 60), (756, 60)],
    "extraNo": [(803, 291), (850, 291), (850, 411), (900, 411), (900, 433)],
    "resubmit": [(611, 45), (98, 45), (98, 258)],
    "ready": [(918, 280), (951, 280)],
    "done": [(1096, 280), (1127, 280)],
    "close": [(1272, 280), (1305, 280)],
}
