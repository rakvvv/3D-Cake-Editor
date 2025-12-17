package com.cake.editor.controller;

import com.cake.editor.dto.StoredPresetDto;
import com.cake.editor.model.AnchorPresetEntity;
import com.cake.editor.model.DecoratedCakePreset;
import com.cake.editor.repository.AnchorPresetRepository;
import com.cake.editor.repository.DecoratedCakePresetRepository;
import com.cake.editor.service.ThumbnailService;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.PathVariable;

import java.util.List;
import java.util.stream.Collectors;

@RestController
@RequestMapping(path = "/api/presets", produces = MediaType.APPLICATION_JSON_VALUE)
public class PresetController {

    private final DecoratedCakePresetRepository decoratedCakePresetRepository;
    private final AnchorPresetRepository anchorPresetRepository;
    private final ThumbnailService thumbnailService;

    public PresetController(DecoratedCakePresetRepository decoratedCakePresetRepository,
                            AnchorPresetRepository anchorPresetRepository,
                            ThumbnailService thumbnailService) {
        this.decoratedCakePresetRepository = decoratedCakePresetRepository;
        this.anchorPresetRepository = anchorPresetRepository;
        this.thumbnailService = thumbnailService;
    }

    @GetMapping("/cakes")
    public List<StoredPresetDto> listDecoratedCakePresets() {
        return decoratedCakePresetRepository.findAll().stream().map(this::toDto).collect(Collectors.toList());
    }

    @GetMapping("/anchors")
    public List<StoredPresetDto> listAnchorPresets() {
        return anchorPresetRepository.findAll().stream().map(this::toDto).collect(Collectors.toList());
    }

    @GetMapping(path = "/cakes/{presetId}/thumbnail", produces = MediaType.IMAGE_PNG_VALUE)
    public ResponseEntity<?> getDecoratedPresetThumbnail(@PathVariable String presetId) {
        try {
            var resource = thumbnailService.loadPresetThumbnail(presetId);
            if (resource == null) {
                return ResponseEntity.notFound().build();
            }
            return ResponseEntity.ok().contentType(MediaType.IMAGE_PNG).body(resource);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    private StoredPresetDto toDto(DecoratedCakePreset preset) {
        StoredPresetDto dto = new StoredPresetDto();
        dto.setId(preset.getPresetId());
        dto.setName(preset.getName());
        dto.setDescription(preset.getDescription());
        dto.setThumbnailUrl(preset.getThumbnailUrl());
        dto.setDataJson(preset.getDataJson());
        dto.setCakeShape(preset.getCakeShape());
        dto.setCakeSize(preset.getCakeSize());
        dto.setTiers(preset.getTiers());
        return dto;
    }

    private StoredPresetDto toDto(AnchorPresetEntity preset) {
        StoredPresetDto dto = new StoredPresetDto();
        dto.setId(preset.getPresetId());
        dto.setName(preset.getName());
        dto.setDataJson(preset.getDataJson());
        dto.setCakeShape(preset.getCakeShape());
        dto.setCakeSize(preset.getCakeSize());
        dto.setTiers(preset.getTiers());
        return dto;
    }
}
