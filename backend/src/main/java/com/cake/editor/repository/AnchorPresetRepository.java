package com.cake.editor.repository;

import com.cake.editor.model.AnchorPresetEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface AnchorPresetRepository extends JpaRepository<AnchorPresetEntity, Long> {
    Optional<AnchorPresetEntity> findByPresetId(String presetId);
}
