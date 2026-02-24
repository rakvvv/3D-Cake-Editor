package com.cake.editor.config;

import com.cake.editor.model.DecoratedCakePreset;
import com.cake.editor.repository.DecoratedCakePresetRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

@Component
public class PresetThumbnailInitializer {

    private static final Logger log = LoggerFactory.getLogger(PresetThumbnailInitializer.class);

    private final DecoratedCakePresetRepository presetRepository;
    private final ApplicationProperties properties;

    public PresetThumbnailInitializer(DecoratedCakePresetRepository presetRepository,
                                      ApplicationProperties properties) {
        this.presetRepository = presetRepository;
        this.properties = properties;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void ensureThumbnailUrls() {
        List<DecoratedCakePreset> presets = presetRepository.findAll();
        int updated = 0;

        for (DecoratedCakePreset preset : presets) {
            Path thumbPath = properties.getStorage()
                    .resolve("thumbnails").resolve("presets").resolve(preset.getPresetId() + ".png");

            if (!Files.exists(thumbPath)) {
                continue;
            }

            if (preset.getThumbnailUrl() == null || preset.getThumbnailUrl().isBlank()) {
                preset.setThumbnailUrl("/api/presets/cakes/" + preset.getPresetId() + "/thumbnail");
                presetRepository.save(preset);
                updated++;
            }
        }

        if (updated > 0) {
            log.info("Zaktualizowano thumbnailUrl dla {} presetów", updated);
        }
    }
}
