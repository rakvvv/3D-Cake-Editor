package com.cake.editor.repository;

import com.cake.editor.model.DecoratedCakePreset;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface DecoratedCakePresetRepository extends JpaRepository<DecoratedCakePreset, Long> {
    Optional<DecoratedCakePreset> findByPresetId(String presetId);
}
