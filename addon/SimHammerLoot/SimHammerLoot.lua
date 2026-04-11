-- SimHammerLoot: Captures group loot roll items for SimHammer
-- Hooks SimcEditBox:SetText() to append loot + debug sections to /simc output

local ADDON_NAME = "SimHammerLoot"
local STALE_SECONDS = 4 * 60 * 60 -- 4 hours
local hooked = false
local DEBUG = true -- set to false to silence debug logs

local function Log(msg)
    if DEBUG then
        print("|cff888888[SH Debug]|r " .. tostring(msg))
    end
end

-- WoW inventoryType -> SimC slot name (12.0 returns string types)
local INV_TYPE_TO_SLOT = {
    INVTYPE_HEAD            = "head",
    INVTYPE_NECK            = "neck",
    INVTYPE_SHOULDER        = "shoulder",
    INVTYPE_CHEST           = "chest",
    INVTYPE_ROBE            = "chest",
    INVTYPE_WAIST           = "waist",
    INVTYPE_LEGS            = "legs",
    INVTYPE_FEET            = "feet",
    INVTYPE_WRIST           = "wrist",
    INVTYPE_HAND            = "hands",
    INVTYPE_FINGER          = "finger1",
    INVTYPE_TRINKET         = "trinket1",
    INVTYPE_WEAPON          = "main_hand",
    INVTYPE_SHIELD          = "off_hand",
    INVTYPE_RANGED          = "main_hand",
    INVTYPE_CLOAK           = "back",
    INVTYPE_2HWEAPON        = "main_hand",
    INVTYPE_WEAPONMAINHAND  = "main_hand",
    INVTYPE_WEAPONOFFHAND   = "off_hand",
    INVTYPE_HOLDABLE        = "off_hand",
    INVTYPE_RANGEDRIGHT     = "main_hand",
}

---------------------------------------------------------------------------
-- Item link parser
---------------------------------------------------------------------------

local function ParseItemLink(itemLink)
    if not itemLink then Log("  ParseItemLink: nil input") return nil end

    local itemString = itemLink:match("|Hitem:([^|]+)|")
    if not itemString then
        Log("  ParseItemLink: no |Hitem: match in link")
        Log("  Raw link bytes: " .. itemLink:gsub("|", "||"))
        return nil
    end

    Log("  ParseItemLink raw string: " .. itemString)

    -- Use strsplit (same as SimC addon) to handle empty fields correctly
    local parts = {}
    for _, v in ipairs({strsplit(":", itemString)}) do
        if v == "" then
            parts[#parts + 1] = 0
        else
            parts[#parts + 1] = tonumber(v)
        end
    end

    Log("  ParseItemLink fields (" .. #parts .. "): " .. table.concat(parts, ", "))

    local itemID = parts[1]
    if not itemID or itemID == 0 then Log("  ParseItemLink: itemID is 0 or nil") return nil end

    -- OFFSET_BONUS_ID = 13 (same as SimC addon)
    -- Validate: numBonuses should be small (0-20) and followed by plausible bonus IDs (>1000)
    local bonusOffset = 13
    local numBonuses = parts[bonusOffset] or 0
    Log("  ParseItemLink numBonuses (field " .. bonusOffset .. ")=" .. tostring(numBonuses))

    -- Sanity check: if numBonuses is unreasonable, try adjacent fields
    if numBonuses < 0 or numBonuses > 20 then
        Log("  numBonuses out of range, scanning nearby fields...")
        for offset = 12, 15 do
            local candidate = parts[offset] or 0
            if candidate >= 0 and candidate <= 20 and offset + candidate <= #parts then
                -- Check if following values look like bonus IDs (typically > 1000)
                local looksValid = true
                for i = 1, candidate do
                    local v = parts[offset + i] or 0
                    if v < 100 then looksValid = false break end
                end
                if candidate > 0 and looksValid then
                    bonusOffset = offset
                    numBonuses = candidate
                    Log("  Found numBonuses=" .. numBonuses .. " at field " .. offset)
                    break
                end
            end
        end
    end

    local bonusIDs = {}
    for i = 1, numBonuses do
        local bid = parts[bonusOffset + i]
        if bid and bid ~= 0 then
            bonusIDs[#bonusIDs + 1] = bid
        end
    end

    return {
        itemID = itemID,
        bonusIDs = bonusIDs,
    }
end

---------------------------------------------------------------------------
-- Dedup key
---------------------------------------------------------------------------

local function MakeKey(itemID, bonusIDs)
    local sorted = {}
    for _, id in ipairs(bonusIDs) do
        sorted[#sorted + 1] = id
    end
    table.sort(sorted)

    local parts = { tostring(itemID) }
    for _, id in ipairs(sorted) do
        parts[#parts + 1] = tostring(id)
    end
    return table.concat(parts, ":")
end

---------------------------------------------------------------------------
-- Build loot section
---------------------------------------------------------------------------

local function BuildLootSection()
    if not SimHammerLootDB or next(SimHammerLootDB) == nil then
        return nil
    end

    local lines = { "# Group Loot" }

    for _, entry in pairs(SimHammerLootDB) do
        local parts = { entry.slot .. "=" }
        parts[#parts + 1] = "id=" .. entry.itemID

        if entry.bonusIDs and #entry.bonusIDs > 0 then
            local bids = {}
            for _, id in ipairs(entry.bonusIDs) do
                bids[#bids + 1] = tostring(id)
            end
            parts[#parts + 1] = "bonus_id=" .. table.concat(bids, "/")
        end

        if entry.ilevel and entry.ilevel > 0 then
            parts[#parts + 1] = "ilevel=" .. entry.ilevel
        end

        if entry.name then
            lines[#lines + 1] = "# " .. entry.name .. (entry.ilevel and (" (" .. entry.ilevel .. ")") or "")
        end
        lines[#lines + 1] = "# " .. table.concat(parts, ",")
    end

    lines[#lines + 1] = "# End of Group Loot"
    return table.concat(lines, "\n")
end

---------------------------------------------------------------------------
-- Build debug section
---------------------------------------------------------------------------

local function BuildDebugSection()
    local lines = { "", "## SIMHAMMER SECTION" }

    lines[#lines + 1] = "# addon_version=0.1.0"
    lines[#lines + 1] = "# export_time=" .. date("%Y-%m-%d %H:%M:%S")

    local count = 0
    if SimHammerLootDB then
        for _ in pairs(SimHammerLootDB) do count = count + 1 end
    end
    lines[#lines + 1] = "# loot_items=" .. count

    local name = UnitName("player") or "Unknown"
    local realm = GetRealmName() or "Unknown"
    local _, className = UnitClass("player")
    local spec = GetSpecialization()
    local specName = spec and select(2, GetSpecializationInfo(spec)) or "None"
    lines[#lines + 1] = "# player=" .. name .. "-" .. realm
    lines[#lines + 1] = "# class=" .. (className or "UNKNOWN")
    lines[#lines + 1] = "# spec=" .. specName

    local inInstance, instanceType = IsInInstance()
    if inInstance then
        local instanceName, _, difficultyID, difficultyName = GetInstanceInfo()
        lines[#lines + 1] = "# instance=" .. (instanceName or "Unknown")
        lines[#lines + 1] = "# difficulty=" .. (difficultyName or "Unknown") .. " (" .. (difficultyID or 0) .. ")"
    else
        lines[#lines + 1] = "# instance=none"
    end

    if GetLootMethod then
        local lootMethod = GetLootMethod()
        lines[#lines + 1] = "# loot_method=" .. (lootMethod or "unknown")
    end

    lines[#lines + 1] = "## END SIMHAMMER SECTION"
    return table.concat(lines, "\n")
end

---------------------------------------------------------------------------
-- Hook Simulationcraft:GetMainFrame() to append our sections
-- GetMainFrame(text) is called after the profile string is built.
-- It creates SimcFrame/SimcEditBox on first call, then does SetText(text).
-- We hook it to modify the text before it reaches the editbox.
---------------------------------------------------------------------------

local function TryHookSimc()
    if hooked then
        Log("Already hooked, skipping.")
        return true
    end

    Log("Attempting hook...")

    -- AceAddon doesn't store as a global, fetch via LibStub
    local ok, simc = pcall(function()
        return LibStub("AceAddon-3.0"):GetAddon("Simulationcraft")
    end)

    if not ok or not simc then
        Log("  Could not get Simulationcraft via LibStub: " .. tostring(simc))
        return false
    end

    Log("  Found addon object: " .. tostring(simc))

    if not simc.GetMainFrame then
        Log("  GetMainFrame not found on addon object!")
        return false
    end

    Log("  GetMainFrame found, hooking...")

    local originalGetMainFrame = simc.GetMainFrame
    simc.GetMainFrame = function(self, text)
        Log("GetMainFrame called! Text length: " .. (text and #text or 0))

        -- Build our append text safely
        local appendOk, appendText = pcall(function()
            local result = ""
            local lootSection = BuildLootSection()
            if lootSection then
                result = result .. "\n\n" .. lootSection
            end
            result = result .. "\n" .. BuildDebugSection()
            return result
        end)

        if not appendOk then
            Log("ERROR building append text: " .. tostring(appendText))
            appendText = ""
        end

        local modifiedText = text .. (appendText or "")
        Log("Calling original GetMainFrame. Modified text length: " .. #modifiedText)

        -- Call original WITHOUT pcall so errors propagate normally
        local frame = originalGetMainFrame(self, modifiedText)
        Log("Original returned: " .. tostring(frame))

        -- Re-hook close-on-copy: the SimC addon's OnKeyUp closure may have stale refs
        -- after our hook. HookScript adds ours alongside the original.
        local eb = _G["SimcEditBox"]
        if eb and not eb._simhammerHooked then
            eb:HookScript("OnKeyUp", function(_, key)
                if (key == "C" or key == "X") and (IsControlKeyDown() or IsMetaKeyDown()) then
                    local checkbox = _G["AutomaticClose"]
                    if checkbox and checkbox:GetChecked() then
                        C_Timer.After(0.1, function()
                            if SimcFrame then SimcFrame:Hide() end
                        end)
                    end
                end
            end)
            eb._simhammerHooked = true
            Log("Hooked SimcEditBox OnKeyUp for close-on-copy.")
        end

        return frame
    end

    hooked = true
    print("|cffC8992ASimHammer:|r Hooked /simc. Output will include loot data.")
    return true
end

---------------------------------------------------------------------------
-- Standalone copy frame (fallback for /simhammer)
---------------------------------------------------------------------------

local copyFrame

local function ShowCopyFrame(text)
    if not copyFrame then
        copyFrame = CreateFrame("Frame", "SimHammerLootCopyFrame", UIParent, "BasicFrameTemplateWithInset")
        copyFrame:SetSize(500, 350)
        copyFrame:SetPoint("CENTER")
        copyFrame:SetMovable(true)
        copyFrame:EnableMouse(true)
        copyFrame:RegisterForDrag("LeftButton")
        copyFrame:SetScript("OnDragStart", copyFrame.StartMoving)
        copyFrame:SetScript("OnDragStop", copyFrame.StopMovingOrSizing)
        copyFrame:SetFrameStrata("DIALOG")

        copyFrame.title = copyFrame:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
        copyFrame.title:SetPoint("TOP", 0, -5)
        copyFrame.title:SetText("SimHammer Loot")

        local scrollFrame = CreateFrame("ScrollFrame", nil, copyFrame, "UIPanelScrollFrameTemplate")
        scrollFrame:SetPoint("TOPLEFT", 12, -32)
        scrollFrame:SetPoint("BOTTOMRIGHT", -30, 12)

        local editBox = CreateFrame("EditBox", nil, scrollFrame)
        editBox:SetMultiLine(true)
        editBox:SetAutoFocus(false)
        editBox:SetFontObject(ChatFontNormal)
        editBox:SetWidth(440)
        editBox:SetScript("OnEscapePressed", function() copyFrame:Hide() end)
        scrollFrame:SetScrollChild(editBox)

        copyFrame.editBox = editBox

        tinsert(UISpecialFrames, "SimHammerLootCopyFrame")
    end

    copyFrame.editBox:SetText(text)
    copyFrame.editBox:HighlightText()
    copyFrame.editBox:SetFocus()
    copyFrame:Show()
end

---------------------------------------------------------------------------
-- Cleanup stale entries
---------------------------------------------------------------------------

local function CleanupStale()
    if not SimHammerLootDB then return end
    local now = time()
    for key, entry in pairs(SimHammerLootDB) do
        if now - (entry.timestamp or 0) > STALE_SECONDS then
            SimHammerLootDB[key] = nil
        end
    end
end

---------------------------------------------------------------------------
-- Event handler
---------------------------------------------------------------------------

local frame = CreateFrame("Frame")
frame:RegisterEvent("ADDON_LOADED")
frame:RegisterEvent("START_LOOT_ROLL")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")

frame:SetScript("OnEvent", function(self, event, ...)
    Log("Event: " .. event .. (select(1, ...) and (" arg1=" .. tostring(select(1, ...))) or ""))

    if event == "ADDON_LOADED" then
        local addonName = ...
        if addonName == ADDON_NAME then
            Log("Our addon loaded.")
            SimHammerLootDB = SimHammerLootDB or {}
            CleanupStale()
            if not TryHookSimc() then
                print("|cffC8992ASimHammer Loot|r loaded. Simulationcraft addon not detected yet, will retry.")
            end
            print("|cffC8992ASimHammer Loot|r v0.1.0 loaded. Type /simhammer for commands.")
        end

    elseif event == "PLAYER_ENTERING_WORLD" then
        -- Retry hook after world loads (SimC addon may have initialized by now)
        TryHookSimc()

    elseif event == "START_LOOT_ROLL" then
        local rollID = ...
        Log("START_LOOT_ROLL rollID=" .. tostring(rollID))

        local itemLink = GetLootRollItemLink(rollID)
        Log("  itemLink=" .. tostring(itemLink))
        if not itemLink then Log("  BAIL: no itemLink") return end

        local parsed = ParseItemLink(itemLink)
        if not parsed then Log("  BAIL: ParseItemLink returned nil") return end
        Log("  parsed itemID=" .. tostring(parsed.itemID) .. " bonusIDs=" .. table.concat(parsed.bonusIDs, "/"))

        local ilevel = 0
        local actualIlevel = GetDetailedItemLevelInfo(itemLink)
        Log("  ilevel from GetDetailedItemLevelInfo=" .. tostring(actualIlevel))
        if actualIlevel then
            ilevel = actualIlevel
        end

        local itemInfoArgs = {GetItemInfoInstant(parsed.itemID)}
        Log("  GetItemInfoInstant returns (" .. #itemInfoArgs .. " values):")
        for idx, val in ipairs(itemInfoArgs) do
            Log("    [" .. idx .. "] = " .. tostring(val) .. " (" .. type(val) .. ")")
        end
        local inventoryType = itemInfoArgs[4]
        Log("  inventoryType=" .. tostring(inventoryType))
        local slot = INV_TYPE_TO_SLOT[inventoryType]
        Log("  slot=" .. tostring(slot))
        if not slot then Log("  BAIL: no slot mapping for inventoryType " .. tostring(inventoryType)) return end

        local rollInfoArgs = {GetLootRollItemInfo(rollID)}
        Log("  GetLootRollItemInfo returns (" .. #rollInfoArgs .. " values):")
        for idx, val in ipairs(rollInfoArgs) do
            Log("    [" .. idx .. "] = " .. tostring(val) .. " (" .. type(val) .. ")")
        end
        local name = rollInfoArgs[2]
        local quality = rollInfoArgs[4]

        local key = MakeKey(parsed.itemID, parsed.bonusIDs)
        SimHammerLootDB[key] = {
            slot = slot,
            itemID = parsed.itemID,
            bonusIDs = parsed.bonusIDs,
            ilevel = ilevel,
            name = name or "Unknown",
            quality = quality or 1,
            timestamp = time(),
        }

        print("|cffC8992ASimHammer:|r Captured " .. (itemLink or name or "item"))
    end
end)

---------------------------------------------------------------------------
-- Global test function: processes a real item link through the full pipeline
-- Usage: /run SimHammerLoot_TestWithLink(select(2,C_Item.GetItemInfo(249343)))
---------------------------------------------------------------------------

function SimHammerLoot_TestWithLink(itemLink)
    if not itemLink then
        print("|cffC8992ASimHammer:|r No item link provided.")
        return
    end

    Log("TestWithLink: " .. itemLink)

    local parsed = ParseItemLink(itemLink)
    if not parsed then
        Log("  Failed to parse item link!")
        return
    end
    Log("  itemID=" .. parsed.itemID .. " bonusIDs=" .. table.concat(parsed.bonusIDs, "/"))

    local ilevel = GetDetailedItemLevelInfo(itemLink) or 0
    Log("  ilevel=" .. ilevel)

    local _, _, _, inventoryType = GetItemInfoInstant(parsed.itemID)
    local slot = INV_TYPE_TO_SLOT[inventoryType or 0]
    Log("  inventoryType=" .. tostring(inventoryType) .. " slot=" .. tostring(slot))

    if not slot then
        Log("  No slot mapping for inventoryType " .. tostring(inventoryType))
        return
    end

    local name = C_Item.GetItemInfo(parsed.itemID)
    Log("  name=" .. tostring(name))

    local key = MakeKey(parsed.itemID, parsed.bonusIDs)
    SimHammerLootDB[key] = {
        slot = slot,
        itemID = parsed.itemID,
        bonusIDs = parsed.bonusIDs,
        ilevel = ilevel,
        name = name or "Unknown",
        quality = 4,
        timestamp = time(),
    }

    print("|cffC8992ASimHammer:|r Test captured " .. itemLink .. " -> " .. slot .. " (ilvl " .. ilevel .. ")")
end

---------------------------------------------------------------------------
-- Slash commands
---------------------------------------------------------------------------

SLASH_SIMHAMMER1 = "/simhammer"
SlashCmdList["SIMHAMMER"] = function(msg)
    msg = strtrim(msg):lower()

    if msg == "clear" then
        SimHammerLootDB = {}
        print("|cffC8992ASimHammer:|r Loot history cleared.")
        return
    end

    if msg == "count" then
        local n = 0
        if SimHammerLootDB then
            for _ in pairs(SimHammerLootDB) do n = n + 1 end
        end
        print("|cffC8992ASimHammer:|r " .. n .. " item(s) captured.")
        return
    end

    if msg == "test" then
        local testItems = {
            { slot = "head",     itemID = 221095, bonusIDs = {10299, 10376, 10840, 1711}, ilevel = 639, name = "Shadowed Court Helm",     quality = 4 },
            { slot = "trinket1", itemID = 225577, bonusIDs = {10299, 10376, 10840, 1711}, ilevel = 639, name = "Signet of the Priory",    quality = 4 },
            { slot = "chest",    itemID = 221088, bonusIDs = {10299, 10376, 10840, 1711}, ilevel = 626, name = "Shadowed Court Vestment",  quality = 4 },
        }
        for _, item in ipairs(testItems) do
            local key = MakeKey(item.itemID, item.bonusIDs)
            SimHammerLootDB[key] = {
                slot = item.slot,
                itemID = item.itemID,
                bonusIDs = item.bonusIDs,
                ilevel = item.ilevel,
                name = item.name,
                quality = item.quality,
                timestamp = time(),
            }
            print("|cffC8992ASimHammer:|r Test captured " .. item.name .. " (" .. item.ilevel .. ")")
        end
        return
    end

    if msg == "hook" then
        if TryHookSimc() then
            print("|cffC8992ASimHammer:|r Hook active.")
        else
            print("|cffC8992ASimHammer:|r Simulationcraft addon not found.")
        end
        return
    end

    if msg == "debug" then
        print("|cffC8992ASimHammer Debug:|r")
        print("  hooked = " .. tostring(hooked))
        print("  SimcEditBox = " .. tostring(_G["SimcEditBox"]))
        print("  SimcFrame = " .. tostring(_G["SimcFrame"]))
        print("  Simulationcraft = " .. tostring(_G["Simulationcraft"]))
        local n = 0
        if SimHammerLootDB then
            for _ in pairs(SimHammerLootDB) do n = n + 1 end
        end
        print("  loot items = " .. n)
        return
    end

    -- Default: show standalone output
    local output = ""
    local lootSection = BuildLootSection()
    if lootSection then
        output = lootSection
    end
    output = output .. BuildDebugSection()

    if output == "" then
        print("|cffC8992ASimHammer:|r No data to show.")
        return
    end

    ShowCopyFrame(output)
end
